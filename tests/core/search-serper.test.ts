import { describe, it, expect } from "bun:test"
import { join } from "path"
import {
  SERPER_BACKEND,
  SERPER_MAX_RESULTS,
  SERPER_SEARCH_URL,
  parseSerperResponse,
} from "@/core/search/serper"
import { SearchResponseShapeError } from "@/core/search/types"
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
    searchParameters: { q: "zod", num: 10, type: "search" },
    organic: entries.map((entry) => ({
      title: entry.title,
      link: entry.url,
      snippet: entry.snippet,
    })),
  }
}

const CREDENTIAL = "serper-secret"

describe("Serper backend: the HTTP seam", () => {
  it("queries the Serper endpoint with the query and the count in the body", async () => {
    const sink: { url?: string; init?: RequestInit } = {}
    await SERPER_BACKEND.search(
      { query: "what changed in zod 4", count: 3, credential: CREDENTIAL },
      { fetchImpl: answering(results(), sink) },
    )
    expect(sink.url).toBe(SERPER_SEARCH_URL)
    expect(new Headers(sink.init?.headers).get("Content-Type")).toBe("application/json")
    const body = JSON.parse(String(sink.init?.body)) as Record<string, unknown>
    expect(body.q).toBe("what changed in zod 4")
    expect(body.num).toBe(3)
  })

  it("authenticates with the credential it was handed, in Serper's own header", async () => {
    const sink: { url?: string; init?: RequestInit } = {}
    await SERPER_BACKEND.search(
      { query: "zod", count: 1, credential: CREDENTIAL },
      { fetchImpl: answering(results(), sink) },
    )
    expect(new Headers(sink.init?.headers).get("X-API-KEY")).toBe(CREDENTIAL)
  })

  it("returns ranked results carrying a title, a URL and a snippet", async () => {
    const found = await SERPER_BACKEND.search(
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

    // Serper's fields are `link` and `snippet`; the ranked result is the one
    // every backend agrees on. The Tool reads this shape and no other.
    expect(found).toEqual([
      { title: "Zod 4 release notes", url: "https://zod.dev/v4", snippet: "Breaking changes." },
      { title: "Migrating to Zod 4", url: "https://blog.example/zod4", snippet: "A guide." },
    ])
  })

  it("caps the list at the count the caller asked for", async () => {
    const found = await SERPER_BACKEND.search(
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
    const found = await SERPER_BACKEND.search(
      { query: "nothing at all", count: 5, credential: CREDENTIAL },
      { fetchImpl: answering({ searchParameters: { q: "nothing at all" }, organic: [] }) },
    )
    expect(found).toEqual([])
  })

  it("declares the ceiling Serper itself enforces", () => {
    expect(SERPER_BACKEND.maxResults).toBe(SERPER_MAX_RESULTS)
  })
})

describe("Serper backend: failures", () => {
  it("raises a transport failure as an HttpError, not as a swallowed error", async () => {
    const fetchImpl = (async () => {
      throw new Error("ENOTFOUND")
    }) as unknown as typeof fetch
    await expect(
      SERPER_BACKEND.search({ query: "zod", count: 1, credential: CREDENTIAL }, { fetchImpl }),
    ).rejects.toThrow(/could not reach/)
  })

  it("raises a rejected credential as a status failure carrying the status", async () => {
    await expect(
      SERPER_BACKEND.search(
        { query: "zod", count: 1, credential: "wrong" },
        { fetchImpl: answering({ message: "Unauthorized" }, undefined, 401) },
      ),
    ).rejects.toThrow(/HTTP 401/)
  })

  it("raises a body that is not JSON as a malformed failure", async () => {
    const fetchImpl = (async () => new Response("<html>oops</html>")) as unknown as typeof fetch
    await expect(
      SERPER_BACKEND.search({ query: "zod", count: 1, credential: CREDENTIAL }, { fetchImpl }),
    ).rejects.toThrow(/not valid JSON/)
  })

  it("raises a JSON body that is not a result set as a shape failure", async () => {
    const fetchImpl = (async () => new Response(JSON.stringify({ hello: "world" }))) as unknown as typeof fetch
    await expect(
      SERPER_BACKEND.search({ query: "zod", count: 1, credential: CREDENTIAL }, { fetchImpl }),
    ).rejects.toBeInstanceOf(SearchResponseShapeError)
  })
})

describe("parseSerperResponse", () => {
  it("reads title, link and snippet into the ranked result shape", () => {
    const parsed = parseSerperResponse({
      searchParameters: { q: "zod" },
      organic: [{ title: "T", link: "https://u.test", snippet: "S" }],
    })
    expect(parsed).toEqual([{ title: "T", url: "https://u.test", snippet: "S" }])
  })

  it("treats a missing snippet as an empty snippet, not a missing result", () => {
    const parsed = parseSerperResponse({
      searchParameters: { q: "zod" },
      organic: [{ title: "T", link: "https://u.test" }],
    })
    expect(parsed).toEqual([{ title: "T", url: "https://u.test", snippet: "" }])
  })

  it("drops an entry with no title or no link, since neither is citeable", () => {
    const parsed = parseSerperResponse({
      searchParameters: { q: "zod" },
      organic: [
        { title: "Good", link: "https://good.test", snippet: "s" },
        { link: "https://untitled.test", snippet: "s" },
        { title: "Unlinked", snippet: "s" },
        null,
      ],
    })
    expect(parsed).toEqual([{ title: "Good", url: "https://good.test", snippet: "s" }])
  })

  it("reads an answer with no organic array as a search that matched nothing", () => {
    // Serper models `organic` as optional: an answer carrying only its echoed
    // search parameters (or a knowledge panel) is a real answer with no
    // organic results, which is an absence rather than a broken response.
    expect(parseSerperResponse({ searchParameters: { q: "zod" } })).toEqual([])
    expect(parseSerperResponse({ searchParameters: { q: "zod" }, answerBox: { title: "T" } })).toEqual([])
  })

  it("returns null for anything that is not an answer, so shape is distinct from empty", () => {
    expect(parseSerperResponse(null)).toBeNull()
    expect(parseSerperResponse("nope")).toBeNull()
    expect(parseSerperResponse({})).toBeNull()
    expect(parseSerperResponse({ hello: "world" })).toBeNull()
    expect(parseSerperResponse({ organic: "many" })).toBeNull()
    expect(parseSerperResponse({ searchParameters: { q: "zod" }, organic: [] })).toEqual([])
  })

  it("treats a non-empty array of unusable entries as a shape failure, not an absence", () => {
    // Serper did not answer "nothing matches": it answered with rows that carry
    // neither a title nor a link, which is the schema having moved.
    expect(parseSerperResponse({ searchParameters: { q: "zod" }, organic: [{ foo: "bar" }, null] })).toBeNull()
  })

  it("contains no `as any` in its response handling", async () => {
    const { readFileSync } = await import("fs")
    const source = readFileSync(join(import.meta.dir, "../../src/core/search/serper.ts"), "utf-8")
    expect(source).not.toContain("as any")
  })
})
