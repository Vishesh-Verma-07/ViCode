import { describe, it, expect } from "bun:test"
import { join } from "path"
import {
  BRAVE_BACKEND,
  BRAVE_MAX_RESULTS,
  BRAVE_SEARCH_URL,
  parseBraveResponse,
} from "@/core/search/brave"
import { SearchResponseShapeError } from "@/core/search/types"
import { DEFAULT_SEARCH_BACKEND, SEARCH_BACKENDS, getSearchBackend, isSearchBackendId, listSearchBackends } from "@/core/search"
import type { SearchResult } from "@/core/search/types"

/** Answers with the given JSON payload, recording the request it received. */
function answering(payload: unknown, sink?: { url?: string; init?: RequestInit }, status = 200): typeof fetch {
  return (async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    if (sink) {
      sink.url = String(input)
      sink.init = init
    }
    return new Response(JSON.stringify(payload), { status })
  }) as unknown as typeof fetch
}

function results(...entries: Array<Partial<SearchResult>>) {
  return {
    web: {
      results: entries.map((entry) => ({
        title: entry.title,
        url: entry.url,
        description: entry.snippet,
      })),
    },
  }
}

const CREDENTIAL = "brave-secret"

describe("search backend registry", () => {
  it("resolves a query to a backend without the Tool naming a vendor", () => {
    expect(getSearchBackend(DEFAULT_SEARCH_BACKEND).id).toBe(DEFAULT_SEARCH_BACKEND)
    expect(isSearchBackendId(DEFAULT_SEARCH_BACKEND)).toBe(true)
    expect(isSearchBackendId("not-a-backend")).toBe(false)
  })

  it("is keyed by id, so a second backend is one entry rather than a rewrite", () => {
    expect(Object.keys(SEARCH_BACKENDS)).toEqual(["brave", "serper"])
    expect(listSearchBackends()).toHaveLength(2)
  })

  it("describes each backend with a credential source and a result ceiling", () => {
    for (const backend of listSearchBackends()) {
      expect(backend.nativeEnv).toMatch(/^[A-Z0-9_]+$/)
      expect(backend.keyUrl).toMatch(/^https:\/\//)
      expect(backend.maxResults).toBeGreaterThan(0)
    }
  })
})

describe("Brave backend: the HTTP seam", () => {
  it("queries the Brave web-search endpoint with the query and the count", async () => {
    const sink: { url?: string; init?: RequestInit } = {}
    await BRAVE_BACKEND.search(
      { query: "what changed in zod 4", count: 3, credential: CREDENTIAL },
      { fetchImpl: answering(results(), sink) },
    )
    const url = new URL(sink.url!)
    expect(url.origin + url.pathname).toBe(BRAVE_SEARCH_URL)
    expect(url.searchParams.get("q")).toBe("what changed in zod 4")
    expect(url.searchParams.get("count")).toBe("3")
  })

  it("authenticates with the credential it was handed, in Brave's own header", async () => {
    const sink: { url?: string; init?: RequestInit } = {}
    await BRAVE_BACKEND.search(
      { query: "zod", count: 1, credential: CREDENTIAL },
      { fetchImpl: answering(results(), sink) },
    )
    expect(new Headers(sink.init?.headers).get("X-Subscription-Token")).toBe(CREDENTIAL)
  })

  it("returns ranked results carrying a title, a URL and a snippet", async () => {
    const found = await BRAVE_BACKEND.search(
      { query: "zod", count: 2, credential: CREDENTIAL },
      {
        fetchImpl: answering(
          results(
            { title: "Zod 4 release notes", url: "https://zod.dev/v4", snippet: "Breaking changes." },
            { title: "Migrating to Zod 4", url: "https://blog.example/zod4", snippet: "A guide." },
          ),
        ),
      },
    )

    expect(found).toEqual([
      { title: "Zod 4 release notes", url: "https://zod.dev/v4", snippet: "Breaking changes." },
      { title: "Migrating to Zod 4", url: "https://blog.example/zod4", snippet: "A guide." },
    ])
  })

  it("caps the list at the count the caller asked for", async () => {
    const found = await BRAVE_BACKEND.search(
      { query: "zod", count: 2, credential: CREDENTIAL },
      {
        fetchImpl: answering(
          results(
            { title: "One", url: "https://one.test", snippet: "a" },
            { title: "Two", url: "https://two.test", snippet: "b" },
            { title: "Three", url: "https://three.test", snippet: "c" },
          ),
        ),
      },
    )
    expect(found.map((r) => r.title)).toEqual(["One", "Two"])
  })

  it("returns an empty list, not an error, when the query matched nothing", async () => {
    const found = await BRAVE_BACKEND.search(
      { query: "nothing at all", count: 5, credential: CREDENTIAL },
      { fetchImpl: answering({ web: { results: [] } }) },
    )
    expect(found).toEqual([])
  })

  it("declares the ceiling Brave itself enforces", () => {
    expect(BRAVE_BACKEND.maxResults).toBe(BRAVE_MAX_RESULTS)
  })
})

describe("Brave backend: failures", () => {
  it("raises a transport failure as an HttpError, not as a swallowed error", async () => {
    const fetchImpl = (async () => {
      throw new Error("ENOTFOUND")
    }) as unknown as typeof fetch
    await expect(
      BRAVE_BACKEND.search({ query: "zod", count: 1, credential: CREDENTIAL }, { fetchImpl }),
    ).rejects.toThrow(/could not reach/)
  })

  it("raises a rejected credential as a status failure carrying the status", async () => {
    await expect(
      BRAVE_BACKEND.search(
        { query: "zod", count: 1, credential: "wrong" },
        { fetchImpl: answering({ error: "bad key" }, undefined, 401) },
      ),
    ).rejects.toThrow(/HTTP 401/)
  })

  it("raises a body that is not JSON as a malformed failure", async () => {
    const fetchImpl = (async () => new Response("<html>oops</html>")) as unknown as typeof fetch
    await expect(
      BRAVE_BACKEND.search({ query: "zod", count: 1, credential: CREDENTIAL }, { fetchImpl }),
    ).rejects.toThrow(/not valid JSON/)
  })

  it("raises a JSON body that is not a result set as a shape failure", async () => {
    // The transport worked and the credential was accepted; the answer is still
    // unusable, which is a different thing for a caller to be told.
    await expect(
      BRAVE_BACKEND.search(
        { query: "zod", count: 1, credential: CREDENTIAL },
        { fetchImpl: answering({ query: { original: "zod" } }) },
      ),
    ).rejects.toBeInstanceOf(SearchResponseShapeError)
  })
})

describe("parseBraveResponse", () => {
  it("reads title, url and description into the result shape", () => {
    const parsed = parseBraveResponse({
      web: { results: [{ title: "T", url: "https://u.test", description: "S" }] },
    })
    expect(parsed).toEqual([{ title: "T", url: "https://u.test", snippet: "S" }])
  })

  it("treats a missing description as an empty snippet, not a missing result", () => {
    const parsed = parseBraveResponse({
      web: { results: [{ title: "T", url: "https://u.test", description: null }] },
    })
    expect(parsed).toEqual([{ title: "T", url: "https://u.test", snippet: "" }])
  })

  it("drops an entry with no title or no URL, since neither is citeable", () => {
    const parsed = parseBraveResponse({
      web: {
        results: [
          { title: "Good", url: "https://good.test", description: "s" },
          { url: "https://untitled.test", description: "s" },
          { title: "Unlinked", description: "s" },
          null,
        ],
      },
    })
    expect(parsed).toEqual([{ title: "Good", url: "https://good.test", snippet: "s" }])
  })

  it("returns null for anything that is not a result set, so shape is distinct from empty", () => {
    expect(parseBraveResponse(null)).toBeNull()
    expect(parseBraveResponse("nope")).toBeNull()
    expect(parseBraveResponse({})).toBeNull()
    expect(parseBraveResponse({ web: null })).toBeNull()
    expect(parseBraveResponse({ web: { results: "many" } })).toBeNull()
    expect(parseBraveResponse({ web: { results: [] } })).toEqual([])
  })

  it("treats a non-empty array of unusable entries as a shape failure, not an absence", () => {
    // Brave did not answer "nothing matches": it answered with rows that carry
    // neither a title nor a URL, which is the schema having moved.
    expect(parseBraveResponse({ web: { results: [{ foo: "bar" }, null] } })).toBeNull()
  })

  it("contains no `as any` in its response handling", async () => {
    const { readFileSync } = await import("fs")
    const source = readFileSync(join(import.meta.dir, "../../src/core/search/brave.ts"), "utf-8")
    expect(source).not.toContain("as any")
  })
})