import { describe, it, expect } from "bun:test"
import {
  httpRequestText,
  httpRequestJson,
  HttpError,
  DEFAULT_HTTP_TIMEOUT_MS,
  DEFAULT_HTTP_MAX_BYTES,
  type HttpFailureKind,
} from "@/core/http"

/** A fetch that answers with the given Response, recording the call it got. */
function respondWith(response: Response, sink?: { url?: string; init?: RequestInit }) {
  return (async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    if (sink) {
      sink.url = String(input)
      sink.init = init
    }
    return response
  }) as unknown as typeof fetch
}

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" },
  })
}

describe("http boundary: success", () => {
  it("returns the body text, its byte count, and whether it was cut", async () => {
    const result = await httpRequestText("https://example.test/page", {
      fetchImpl: respondWith(new Response("hello world")),
    })
    expect(result.text).toBe("hello world")
    expect(result.bytes).toBe(11)
    expect(result.truncated).toBe(false)
    expect(result.status).toBe(200)
  })

  it("parses a JSON body and reports the same byte accounting", async () => {
    const result = await httpRequestJson<{ hello: string }>("https://example.test/api", {
      fetchImpl: respondWith(jsonResponse({ hello: "world" })),
    })
    expect(result.json).toEqual({ hello: "world" })
    expect(result.truncated).toBe(false)
    expect(result.bytes).toBeGreaterThan(0)
  })

  it("passes the method, headers and body through to the transport", async () => {
    const sink: { url?: string; init?: RequestInit } = {}
    await httpRequestText("https://example.test/api", {
      method: "POST",
      headers: { "X-Subscription-Token": "secret" },
      body: '{"q":"zod 4"}',
      fetchImpl: respondWith(jsonResponse({ ok: true }), sink),
    })
    expect(sink.url).toBe("https://example.test/api")
    expect(sink.init?.method).toBe("POST")
    expect(new Headers(sink.init?.headers).get("X-Subscription-Token")).toBe("secret")
    expect(sink.init?.body).toBe('{"q":"zod 4"}')
  })

  it("sends an abort signal so a caller can cancel a request in flight", async () => {
    const sink: { init?: RequestInit } = {}
    await httpRequestText("https://example.test/page", {
      fetchImpl: respondWith(new Response("ok"), sink),
    })
    expect(sink.init?.signal).toBeInstanceOf(AbortSignal)
  })
})

describe("http boundary: streamed byte ceiling", () => {
  it("cuts the body at the ceiling and says it was cut", async () => {
    const result = await httpRequestText("https://example.test/big", {
      maxBytes: 10,
      fetchImpl: respondWith(new Response("0123456789abcdefghij")),
    })
    expect(result.text).toBe("0123456789")
    expect(result.truncated).toBe(true)
    expect(result.bytes).toBe(10)
  })

  it("abandons the read at the ceiling rather than buffering the whole body", async () => {
    // A stream that would produce far more than the cap: the boundary must stop
    // reading at the ceiling, so the tail is never handed to it.
    let produced = 0
    let cancelled = false
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (produced >= 100) {
          controller.close()
          return
        }
        produced += 10
        controller.enqueue(new TextEncoder().encode("0123456789"))
      },
      cancel() {
        cancelled = true
      },
    })

    const result = await httpRequestText("https://example.test/huge", {
      maxBytes: 25,
      fetchImpl: respondWith(new Response(stream)),
    })

    expect(result.text).toBe("0123456789012345678901234")
    expect(result.truncated).toBe(true)
    expect(cancelled).toBe(true)
    expect(produced).toBeLessThan(100)
  })

  it("decodes on a character boundary, never on a split code point", async () => {
    // "é" is two bytes, so a one-byte cap lands mid-character. Decoding the cut
    // as-is would yield a replacement character the model reads as content.
    const result = await httpRequestText("https://example.test/accents", {
      maxBytes: 1,
      fetchImpl: respondWith(new Response("aéb")),
    })
    expect(result.text).toBe("a")
    expect(result.truncated).toBe(true)
  })

  it("defaults the ceiling and the timeout rather than leaving them open", () => {
    expect(DEFAULT_HTTP_MAX_BYTES).toBeGreaterThan(0)
    expect(DEFAULT_HTTP_TIMEOUT_MS).toBeGreaterThan(0)
  })
})

describe("http boundary: the timeout spans the body, not just the handshake", () => {
  it("gives up on a host that answers with headers and then stalls mid-body", async () => {
    // The stall is the case a handshake-only timeout misses: the response has
    // already arrived, so the request looks finished to anything watching only
    // the fetch, and the read below it hangs forever instead.
    let abortBody: () => void = () => undefined
    const stalled = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("partial"))
        // Never closed, never another chunk, until the signal ends it.
        abortBody = () => controller.error(new Error("aborted"))
      },
    })

    const fetchImpl = (async (_input: unknown, init?: RequestInit) => {
      init?.signal?.addEventListener("abort", abortBody)
      return new Response(stalled)
    }) as unknown as typeof fetch

    let error: unknown
    try {
      await httpRequestText("https://example.test/stalls", { fetchImpl, timeoutMs: 30 })
    } catch (e) {
      error = e
    }
    expect(error).toBeInstanceOf(HttpError)
    expect((error as HttpError).kind).toBe("timeout")
  })

  it("classifies a body that breaks part-way as a transport failure, not a status one", async () => {
    // The status line said 200, so this is not a refusal and not a schema
    // problem — the connection died delivering a body it had promised.
    const broken = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("half"))
        controller.error(new Error("socket hang up"))
      },
    })

    let error: unknown
    try {
      await httpRequestText("https://example.test/broken", {
        fetchImpl: respondWith(new Response(broken)),
      })
    } catch (e) {
      error = e
    }
    expect(error).toBeInstanceOf(HttpError)
    expect((error as HttpError).kind).toBe("transport")
    expect((error as HttpError).message).toContain("part-way")
  })
})

describe("http boundary: four distinguishable failures", () => {
  it("classifies a timeout as its own outcome", async () => {
    const fetchImpl = (async (_input: unknown, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new Error("aborted")))
      })) as unknown as typeof fetch

    let error: unknown
    try {
      await httpRequestText("https://example.test/slow", { fetchImpl, timeoutMs: 20 })
    } catch (e) {
      error = e
    }
    expect(error).toBeInstanceOf(HttpError)
    expect((error as HttpError).kind).toBe("timeout")
  })

  it("classifies a non-success status as its own outcome, carrying the status", async () => {
    let error: unknown
    try {
      await httpRequestText("https://example.test/gone", {
        fetchImpl: respondWith(new Response("nope", { status: 404 })),
      })
    } catch (e) {
      error = e
    }
    expect(error).toBeInstanceOf(HttpError)
    expect((error as HttpError).kind).toBe("status")
    expect((error as HttpError).status).toBe(404)
  })

  it("classifies a transport failure as its own outcome", async () => {
    const fetchImpl = (async () => {
      throw new Error("ECONNREFUSED")
    }) as unknown as typeof fetch

    let error: unknown
    try {
      await httpRequestText("https://example.test/unreachable", { fetchImpl })
    } catch (e) {
      error = e
    }
    expect(error).toBeInstanceOf(HttpError)
    expect((error as HttpError).kind).toBe("transport")
  })

  it("classifies an unparseable body as its own outcome, not as a transport failure", async () => {
    let error: unknown
    try {
      await httpRequestJson("https://example.test/api", {
        fetchImpl: respondWith(new Response("{ not json")),
      })
    } catch (e) {
      error = e
    }
    expect(error).toBeInstanceOf(HttpError)
    expect((error as HttpError).kind).toBe("malformed")
  })

  it("tells the four failures apart by kind, not by message text", () => {
    const kinds: HttpFailureKind[] = ["timeout", "status", "transport", "malformed"]
    expect(new Set(kinds).size).toBe(4)
    for (const kind of kinds) {
      const error = new HttpError(kind, "https://example.test", "boom")
      expect(error.kind).toBe(kind)
      expect(error.url).toBe("https://example.test")
    }
  })

  it("carries the URL on every failure so the model can be told what was reached", async () => {
    let error: unknown
    try {
      await httpRequestText("https://example.test/missing", {
        fetchImpl: respondWith(new Response("", { status: 500 })),
      })
    } catch (e) {
      error = e
    }
    expect((error as HttpError).url).toBe("https://example.test/missing")
  })
})