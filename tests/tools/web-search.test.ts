import { describe, it, expect, beforeEach, afterEach } from "bun:test"
import { join } from "path"
import { mkdirSync, rmSync, existsSync } from "fs"
import { webSearchTool, setWebSearchDeps, formatResults } from "@/tools/web-search"
import { DEFAULT_RESULT_COUNT } from "@/tools/web-search"
import { getSearchBackend, DEFAULT_SEARCH_BACKEND } from "@/core/search"
import { searchEnvVars } from "@/core/search/credential"
import type { ToolContext } from "@/core/types"
import type { AppConfig } from "@/config/config"

const tmpDir = join(import.meta.dir, "__tmp_web_search_test")
const ctx: ToolContext = { projectPath: tmpDir }

const backend = getSearchBackend(DEFAULT_SEARCH_BACKEND)
const [NAMESPACED, NATIVE] = searchEnvVars(backend)

const CONFIG_WITH_KEY: AppConfig = { apiKeys: {}, searchApiKey: "brave-secret" }

/** A fetch answering with a Brave result set of `n` entries. */
function answering(n: number, sink?: { url?: string; init?: RequestInit }): typeof fetch {
  return (async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    if (sink) {
      sink.url = String(input)
      sink.init = init
    }
    const results = Array.from({ length: n }, (_, i) => ({
      title: `Result ${i + 1}`,
      url: `https://example.test/${i + 1}`,
      description: `Snippet ${i + 1}.`,
    }))
    return new Response(JSON.stringify({ web: { results } }), { status: 200 })
  }) as unknown as typeof fetch
}

function call(args: Record<string, unknown>) {
  return webSearchTool.execute(args, ctx)
}

let savedEnv: Record<string, string | undefined> = {}
let restore: (() => void) | undefined

beforeEach(() => {
  if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true })
  mkdirSync(tmpDir, { recursive: true })
  savedEnv = {}
  for (const name of [NAMESPACED, NATIVE]) {
    savedEnv[name] = process.env[name]
    delete process.env[name]
  }
})

afterEach(() => {
  restore?.()
  restore = undefined
  for (const [name, value] of Object.entries(savedEnv)) {
    if (value === undefined) delete process.env[name]
    else process.env[name] = value
  }
  if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true })
})

function useDeps(deps: Parameters<typeof setWebSearchDeps>[0]) {
  restore = setWebSearchDeps(deps)
}

describe("web_search metadata", () => {
  it("is one Tool, named web_search, and read-only", () => {
    expect(webSearchTool.name).toBe("web_search")
    // Read-only in the strict sense: it changes nothing on disk, which is why
    // it is offered in every Mode.
    expect(webSearchTool.dangerous).toBe(false)
    expect(webSearchTool.requiresApproval).toBeUndefined()
  })

  it("describes itself in terms of ranked results and the page/snippet distinction", () => {
    expect(webSearchTool.description).toMatch(/ranked results/)
    expect(webSearchTool.description).toMatch(/snippet/)
    expect(webSearchTool.description).toMatch(/URL/)
  })

  it("declares only parameters it reads", async () => {
    const shape = webSearchTool.parameters.shape as Record<string, unknown>
    expect(Object.keys(shape).sort()).toEqual(["numResults", "query"])

    // Both declared parameters reach the request: the query and the count.
    const sink: { url?: string; init?: RequestInit } = {}
    useDeps({ config: CONFIG_WITH_KEY, fetchImpl: answering(3, sink) })
    await call({ query: "zod 4", numResults: 3 })
    const url = new URL(sink.url!)
    expect(url.searchParams.get("q")).toBe("zod 4")
    expect(url.searchParams.get("count")).toBe("3")
  })

  it("accepts and reads a caller-chosen number of results", async () => {
    useDeps({ config: CONFIG_WITH_KEY, fetchImpl: answering(20) })
    const one = await call({ query: "zod", numResults: 1 })
    expect(one).toContain("1 result(s)")
    expect(one).not.toContain("Result 2")
  })

  it("clamps a count above the backend's ceiling rather than sending an invalid one", async () => {
    const sink: { url?: string; init?: RequestInit } = {}
    useDeps({ config: CONFIG_WITH_KEY, fetchImpl: answering(1, sink) })
    await call({ query: "zod", numResults: 500 })
    expect(new URL(sink.url!).searchParams.get("count")).toBe(String(backend.maxResults))
  })

  it("falls back to a default count when the caller names none", async () => {
    const sink: { url?: string; init?: RequestInit } = {}
    useDeps({ config: CONFIG_WITH_KEY, fetchImpl: answering(1, sink) })
    await call({ query: "zod" })
    expect(new URL(sink.url!).searchParams.get("count")).toBe(String(DEFAULT_RESULT_COUNT))
  })
})

describe("web_search results", () => {
  it("returns a ranked list, each entry carrying its title, its URL and a snippet", async () => {
    useDeps({ config: CONFIG_WITH_KEY, fetchImpl: answering(2) })
    const result = await call({ query: "zod 4", numResults: 2 })

    expect(result).toContain("1. Result 1")
    expect(result).toContain("https://example.test/1")
    expect(result).toContain("Snippet 1.")
    expect(result).toContain("2. Result 2")
    expect(result).toContain("https://example.test/2")
  })

  it("tells the model a snippet is an excerpt and the page is a fetch away", async () => {
    useDeps({ config: CONFIG_WITH_KEY, fetchImpl: answering(1) })
    const result = await call({ query: "zod", numResults: 1 })
    expect(result).toMatch(/excerpt/i)
    expect(result).toMatch(/fetch/i)
  })

  it("marks a result with no snippet rather than dropping it or inventing one", () => {
    const rendered = formatResults("q", [{ title: "T", url: "https://u.test", snippet: "" }])
    expect(rendered).toContain("(no snippet returned)")
  })
})

describe("web_search with no credential configured", () => {
  it("names the missing credential and how to set it", async () => {
    useDeps({ config: { apiKeys: {} }, fetchImpl: answering(1) })
    const result = await call({ query: "zod", numResults: 1 })

    expect(result).toContain("searchApiKey")
    expect(result).toContain(NAMESPACED)
    expect(result).toContain(NATIVE)
    expect(result).toContain(backend.keyUrl)
  })

  it("says this is a missing credential and not an empty result", async () => {
    useDeps({ config: { apiKeys: {} }, fetchImpl: answering(1) })
    const result = await call({ query: "zod", numResults: 1 })
    expect(result).toMatch(/not an empty result/i)
  })

  it("runs no request at all, rather than calling unauthenticated and failing", async () => {
    let called = false
    useDeps({
      config: { apiKeys: {} },
      fetchImpl: (async () => {
        called = true
        return new Response("{}")
      }) as unknown as typeof fetch,
    })
    await call({ query: "zod", numResults: 1 })
    expect(called).toBe(false)
  })

  it("authenticates on the namespaced variable when no config carries one", async () => {
    process.env[NAMESPACED] = "brave-from-env"
    const sink: { url?: string; init?: RequestInit } = {}
    useDeps({ config: { apiKeys: {} }, fetchImpl: answering(1, sink) })
    const result = await call({ query: "zod", numResults: 1 })
    expect(new Headers(sink.init?.headers).get("X-Subscription-Token")).toBe("brave-from-env")
    expect(result).toContain("Result 1")
  })

  it("gates nothing: with no credential, an ordinary local Tool Call still works", async () => {
    // The point of reporting at use rather than at startup: the Session is not
    // gated on a credential for a Tool the user may never call.
    useDeps({ config: { apiKeys: {} } })
    const { searchTool } = await import("@/tools/search")
    const found = await searchTool.execute({ query: "nothing-matches-this-literal" }, ctx)
    expect(found).toBe("No matches found")
  })
})

describe("web_search: four outcomes stay distinct", () => {
  it("states a search that matched nothing plainly, never as an empty string", async () => {
    useDeps({
      config: CONFIG_WITH_KEY,
      fetchImpl: (async () =>
        new Response(JSON.stringify({ web: { results: [] } }), { status: 200 })) as unknown as typeof fetch,
    })
    const result = await call({ query: "obscure query", numResults: 5 })

    expect(result.trim()).not.toBe("")
    expect(result).toMatch(/matched nothing/i)
    expect(result).toMatch(/absence, not a failure/i)
    expect(result).not.toMatch(/HTTP|timeout|could not reach/i)
  })

  it("states a transport failure as a transport failure", async () => {
    useDeps({
      config: CONFIG_WITH_KEY,
      fetchImpl: (async () => {
        throw new Error("ECONNREFUSED")
      }) as unknown as typeof fetch,
    })
    const result = await call({ query: "zod", numResults: 1 })

    expect(result).toMatch(/could not run/i)
    expect(result).toMatch(/network failed/i)
    expect(result).not.toMatch(/matched nothing/i)
  })

  it("states a timeout as a timeout, separately from a transport failure", async () => {
    useDeps({
      config: CONFIG_WITH_KEY,
      timeoutMs: 20,
      fetchImpl: (async (_input: unknown, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(new Error("aborted")))
        })) as unknown as typeof fetch,
    })
    const result = await call({ query: "zod", numResults: 1 })

    expect(result).toMatch(/timed out/i)
    expect(result).not.toMatch(/matched nothing/i)
  })

  it("states a rejected credential as a credential problem", async () => {
    useDeps({
      config: CONFIG_WITH_KEY,
      fetchImpl: (async () => new Response("nope", { status: 401 })) as unknown as typeof fetch,
    })
    const result = await call({ query: "zod", numResults: 1 })

    expect(result).toMatch(/HTTP 401/)
    expect(result).toMatch(/credential was rejected/i)
    expect(result).not.toMatch(/matched nothing/i)
  })

  it("states a malformed body separately from a transport failure", async () => {
    useDeps({
      config: CONFIG_WITH_KEY,
      fetchImpl: (async () => new Response("<html>maintenance</html>")) as unknown as typeof fetch,
    })
    const result = await call({ query: "zod", numResults: 1 })

    expect(result).toMatch(/not valid JSON/i)
    expect(result).not.toMatch(/network failed/i)
    expect(result).not.toMatch(/matched nothing/i)
  })

  it("states a well-formed response that is not a result set as a shape failure", async () => {
    useDeps({
      config: CONFIG_WITH_KEY,
      fetchImpl: (async () =>
        new Response(JSON.stringify({ query: { original: "zod" } }), { status: 200 })) as unknown as typeof fetch,
    })
    const result = await call({ query: "zod", numResults: 1 })

    expect(result).toMatch(/not shaped as expected/i)
    expect(result).not.toMatch(/matched nothing/i)
  })

  it("says every failure is a failure, so the model never reads one as an absence", async () => {
    const failures = [
      (async () => { throw new Error("ECONNREFUSED") }) as unknown as typeof fetch,
      (async () => new Response("nope", { status: 500 })) as unknown as typeof fetch,
      (async () => new Response("<html>")) as unknown as typeof fetch,
    ]
    for (const fetchImpl of failures) {
      useDeps({ config: CONFIG_WITH_KEY, fetchImpl })
      const result = await call({ query: "zod", numResults: 1 })
      expect(result).toMatch(/This is a failure, not an absence/)
    }
  })
})

describe("web_search contains no `as any` in its response handling", () => {
  it("has no `as any` anywhere in the Tool or a backend", async () => {
    const { readFileSync } = await import("fs")
    for (const file of ["web-search.ts"]) {
      const source = readFileSync(join(import.meta.dir, "../../src/tools", file), "utf-8")
      expect(source).not.toContain("as any")
    }
  })
})