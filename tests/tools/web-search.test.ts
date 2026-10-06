import { describe, it, expect, beforeEach, afterEach } from "bun:test"
import { join } from "path"
import { mkdirSync, rmSync, existsSync, readFileSync } from "fs"
import {
  webSearchTool,
  setWebSearchDeps,
  formatResults,
  DEFAULT_RESULT_COUNT,
} from "@/tools/web-search"
import { getSearchBackend, listSearchBackends, SEARCH_BACKENDS } from "@/core/search"
import { SEARCH_BACKEND_IDS, type SearchBackendId } from "@/core/search/types"
import { searchEnvVars } from "@/core/search/credential"
import { BRAVE_SEARCH_URL } from "@/core/search/brave"
import { SERPER_SEARCH_URL } from "@/core/search/serper"
import { SEARCH_CREDENTIALS_FIELD } from "@/config/config"
import type { ToolContext } from "@/core/types"
import type { AppConfig } from "@/config/config"

const tmpDir = join(import.meta.dir, "__tmp_web_search_test")
const ctx: ToolContext = { projectPath: tmpDir }

const CREDENTIAL = "backend-secret"

interface RequestSink {
  url?: string
  init?: RequestInit
}

/**
 * One backend's wire format, so the Tool's own tests can run against every
 * backend that ships without changing a single assertion.
 *
 * This is the seam the ticket is about: a fixture knows how its backend puts a
 * query on the wire and how it answers, and nothing else. The assertions below
 * speak only in terms of a query, a count, a credential and ranked results — if
 * one of them had to branch on the backend, the Tool would be telling them
 * apart, which is the failure this file exists to catch.
 */
interface BackendFixture {
  id: SearchBackendId
  /** Where a search goes out to. */
  endpoint: string
  /** Answers with `n` ranked results in this backend's own response shape. */
  answering(n: number, sink?: RequestSink): typeof fetch
  /** Reads the query, the count and the credential back out of a request. */
  readRequest(sink: RequestSink): { query: string | null; count: string | null; credential: string | null }
}

function headers(sink: RequestSink): Headers {
  return new Headers(sink.init?.headers)
}

const BRAVE_FIXTURE: BackendFixture = {
  id: "brave",
  endpoint: BRAVE_SEARCH_URL,
  answering(n, sink) {
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
  },
  readRequest(sink) {
    const url = new URL(sink.url ?? "")
    return {
      query: url.searchParams.get("q"),
      count: url.searchParams.get("count"),
      credential: headers(sink).get("X-Subscription-Token"),
    }
  },
}

const SERPER_FIXTURE: BackendFixture = {
  id: "serper",
  endpoint: SERPER_SEARCH_URL,
  answering(n, sink) {
    return (async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
      if (sink) {
        sink.url = String(input)
        sink.init = init
      }
      const organic = Array.from({ length: n }, (_, i) => ({
        title: `Result ${i + 1}`,
        link: `https://example.test/${i + 1}`,
        snippet: `Snippet ${i + 1}.`,
      }))
      return new Response(JSON.stringify({ searchParameters: { q: "q" }, organic }), { status: 200 })
    }) as unknown as typeof fetch
  },
  readRequest(sink) {
    const body = JSON.parse(String(sink.init?.body ?? "")) as Record<string, unknown>
    return {
      query: typeof body.q === "string" ? body.q : null,
      count: body.num === undefined ? null : String(body.num),
      credential: headers(sink).get("X-API-KEY"),
    }
  },
}

/** Every backend that ships, each with the fixture that speaks its wire format. */
const BACKEND_FIXTURES: BackendFixture[] = [BRAVE_FIXTURE, SERPER_FIXTURE]

/** A config naming the fixture's backend, holding that backend's credential. */
function configFor(fixture: BackendFixture): AppConfig {
  const searchApiKeys = { [fixture.id]: CREDENTIAL } as NonNullable<AppConfig["searchApiKeys"]>
  return { apiKeys: {}, searchBackend: fixture.id, searchApiKeys }
}

let savedEnv: Record<string, string | undefined> = {}
let restore: (() => void) | undefined

/** Every variable any backend's credential is read from, so none leaks in. */
const SEARCH_ENV_VARS = [...new Set(listSearchBackends().flatMap((b) => searchEnvVars(b)))]

beforeEach(() => {
  if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true })
  mkdirSync(tmpDir, { recursive: true })
  savedEnv = {}
  for (const name of SEARCH_ENV_VARS) {
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

  it("names no backend id in its own source, so the choice stays outside the Tool", () => {
    // The interface is only real if the Tool cannot name what is behind it. A
    // backend id in here would mean the selection leaked into the Tool itself.
    const source = readFileSync(join(import.meta.dir, "../../src/tools/web-search.ts"), "utf-8")
    for (const id of SEARCH_BACKEND_IDS) expect(source).not.toContain(id)
  })

  it("is covered for every backend that ships, so none is exempt", () => {
    expect(BACKEND_FIXTURES.map((fixture) => fixture.id)).toEqual([...SEARCH_BACKEND_IDS])
  })

  it("marks a result with no snippet rather than dropping it or inventing one", () => {
    const rendered = formatResults("q", [{ title: "T", url: "https://u.test", snippet: "" }])
    expect(rendered).toContain("(no snippet returned)")
  })

  it("has no `as any` anywhere in the Tool's response handling", () => {
    const source = readFileSync(join(import.meta.dir, "../../src/tools/web-search.ts"), "utf-8")
    expect(source).not.toContain("as any")
  })
})

for (const fixture of BACKEND_FIXTURES) {
  const backend = getSearchBackend(fixture.id)
  const [NAMESPACED, NATIVE] = searchEnvVars(backend)

  const call = (args: Record<string, unknown>) => webSearchTool.execute(args, ctx)

  describe(`web_search via ${fixture.id}`, () => {
    it("declares only parameters it reads, and both reach the request", async () => {
      const shape = webSearchTool.parameters.shape as Record<string, unknown>
      expect(Object.keys(shape).sort()).toEqual(["numResults", "query"])

      const sink: RequestSink = {}
      useDeps({ config: configFor(fixture), fetchImpl: fixture.answering(3, sink) })
      await call({ query: "zod 4", numResults: 3 })
      const request = fixture.readRequest(sink)
      expect(request.query).toBe("zod 4")
      expect(request.count).toBe("3")
    })

    it("accepts and reads a caller-chosen number of results", async () => {
      useDeps({ config: configFor(fixture), fetchImpl: fixture.answering(20) })
      const one = await call({ query: "zod", numResults: 1 })
      expect(one).toContain("1 result(s)")
      expect(one).not.toContain("Result 2")
    })

    it("clamps a count above the backend's ceiling rather than sending an invalid one", async () => {
      const sink: RequestSink = {}
      useDeps({ config: configFor(fixture), fetchImpl: fixture.answering(1, sink) })
      await call({ query: "zod", numResults: 500 })
      expect(fixture.readRequest(sink).count).toBe(String(backend.maxResults))
    })

    it("falls back to a default count when the caller names none", async () => {
      const sink: RequestSink = {}
      useDeps({ config: configFor(fixture), fetchImpl: fixture.answering(1, sink) })
      await call({ query: "zod" })
      expect(fixture.readRequest(sink).count).toBe(String(DEFAULT_RESULT_COUNT))
    })

    it("states no ceiling of its own, leaving that number to the backend", () => {
      // A count written into the schema description would be a second home for
      // `maxResults`, and the registry could contradict it.
      const shape = webSearchTool.parameters.shape as Record<string, { description?: string }>
      const description = shape.numResults?.description ?? ""
      expect(description).toContain("clamped")
      expect(description).not.toContain(String(backend.maxResults))
    })

    it("sends the search to the backend the config names, with that backend's credential", async () => {
      // The whole ticket in one test: the Tool is handed an id and a config,
      // and the request leaves for that backend — no backend id is written here.
      const sink: RequestSink = {}
      useDeps({ config: configFor(fixture), fetchImpl: fixture.answering(1, sink) })
      await call({ query: "zod" })
      expect(sink.url?.startsWith(fixture.endpoint)).toBe(true)
      expect(fixture.readRequest(sink).credential).toBe(CREDENTIAL)
    })

    it("returns a ranked list, each entry carrying its title, its URL and a snippet", async () => {
      useDeps({ config: configFor(fixture), fetchImpl: fixture.answering(2) })
      const result = await call({ query: "zod 4", numResults: 2 })

      expect(result).toContain("1. Result 1")
      expect(result).toContain("https://example.test/1")
      expect(result).toContain("Snippet 1.")
      expect(result).toContain("2. Result 2")
      expect(result).toContain("https://example.test/2")
    })

    it("tells the model a snippet is an excerpt and the page is a fetch away", async () => {
      useDeps({ config: configFor(fixture), fetchImpl: fixture.answering(1) })
      const result = await call({ query: "zod", numResults: 1 })
      expect(result).toMatch(/excerpt/i)
      expect(result).toMatch(/fetch/i)
    })

    it("names the missing credential for this backend and how to set it", async () => {
      // Two backends means "no credential" has to say which one, or the user
      // holding a key for the other is told to obtain one they already have.
      useDeps({ config: { apiKeys: {}, searchBackend: fixture.id }, fetchImpl: fixture.answering(1) })
      const result = await call({ query: "zod", numResults: 1 })

      expect(result).toContain(`"${fixture.id}"`)
      expect(result).toContain(backend.label)
      expect(result).toContain(SEARCH_CREDENTIALS_FIELD)
      expect(result).toContain(NAMESPACED)
      expect(result).toContain(NATIVE)
      expect(result).toContain(backend.keyUrl)
    })

    it("says this is a missing credential and not an empty result", async () => {
      useDeps({ config: { apiKeys: {}, searchBackend: fixture.id }, fetchImpl: fixture.answering(1) })
      const result = await call({ query: "zod", numResults: 1 })
      expect(result).toMatch(/not an empty result/i)
    })

    it("runs no request at all, rather than calling unauthenticated and failing", async () => {
      let called = false
      useDeps({
        config: { apiKeys: {}, searchBackend: fixture.id },
        fetchImpl: (async () => {
          called = true
          return new Response("{}")
        }) as unknown as typeof fetch,
      })
      await call({ query: "zod", numResults: 1 })
      expect(called).toBe(false)
    })

    it("authenticates on the namespaced variable when no config carries one", async () => {
      process.env[NAMESPACED] = `${fixture.id}-from-env`
      const sink: RequestSink = {}
      useDeps({ config: { apiKeys: {}, searchBackend: fixture.id }, fetchImpl: fixture.answering(1, sink) })
      const result = await call({ query: "zod", numResults: 1 })
      expect(fixture.readRequest(sink).credential).toBe(`${fixture.id}-from-env`)
      expect(result).toContain("Result 1")
    })

    it("states a search that matched nothing plainly, never as an empty string", async () => {
      useDeps({ config: configFor(fixture), fetchImpl: fixture.answering(0) })
      const result = await call({ query: "obscure query", numResults: 5 })

      expect(result.trim()).not.toBe("")
      expect(result).toMatch(/matched nothing/i)
      expect(result).toMatch(/absence, not a failure/i)
      expect(result).not.toMatch(/HTTP|timeout|could not reach/i)
    })

    it("states a transport failure as a transport failure", async () => {
      useDeps({
        config: configFor(fixture),
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
        config: configFor(fixture),
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
        config: configFor(fixture),
        fetchImpl: (async () => new Response("nope", { status: 401 })) as unknown as typeof fetch,
      })
      const result = await call({ query: "zod", numResults: 1 })

      expect(result).toMatch(/HTTP 401/)
      expect(result).toMatch(/credential was rejected/i)
      expect(result).not.toMatch(/matched nothing/i)
    })

    it("states a malformed body separately from a transport failure", async () => {
      useDeps({
        config: configFor(fixture),
        fetchImpl: (async () => new Response("<html>maintenance</html>")) as unknown as typeof fetch,
      })
      const result = await call({ query: "zod", numResults: 1 })

      expect(result).toMatch(/not valid JSON/i)
      expect(result).not.toMatch(/network failed/i)
      expect(result).not.toMatch(/matched nothing/i)
    })

    it("states a well-formed response that is not a result set as a shape failure", async () => {
      useDeps({
        config: configFor(fixture),
        fetchImpl: (async () =>
          new Response(JSON.stringify({ hello: "world" }), { status: 200 })) as unknown as typeof fetch,
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
        useDeps({ config: configFor(fixture), fetchImpl })
        const result = await call({ query: "zod", numResults: 1 })
        expect(result).toMatch(/This is a failure, not an absence/)
      }
    })

    it("gates nothing: with no credential, an ordinary local Tool Call still works", async () => {
      // The point of reporting at use rather than at startup: the Session is not
      // gated on a credential for a Tool the user may never call.
      useDeps({ config: { apiKeys: {}, searchBackend: fixture.id } })
      const { searchTool } = await import("@/tools/search")
      const found = await searchTool.execute({ query: "nothing-matches-this-literal" }, ctx)
      expect(found).toBe("No matches found")
    })
  })
}

describe("web_search: choosing a backend", () => {
  const call = (args: Record<string, unknown>) => webSearchTool.execute(args, ctx)

  it("routes to the backend the config names, away from the default", async () => {
    const sink: RequestSink = {}
    useDeps({
      config: {
        apiKeys: {},
        searchBackend: "serper",
        searchApiKeys: { serper: CREDENTIAL },
      },
      fetchImpl: SERPER_FIXTURE.answering(1, sink),
    })
    const result = await call({ query: "zod" })
    expect(sink.url).toBe(SERPER_SEARCH_URL)
    expect(result).toContain("Result 1")
  })

  it("falls back to the default backend when no selection is configured", async () => {
    const sink: RequestSink = {}
    useDeps({
      config: { apiKeys: {}, searchApiKeys: { brave: CREDENTIAL } },
      fetchImpl: BRAVE_FIXTURE.answering(1, sink),
    })
    await call({ query: "zod" })
    expect(sink.url?.startsWith(BRAVE_SEARCH_URL)).toBe(true)
  })

  it("falls back to the default backend for an id the registry does not hold", async () => {
    // The type forbids such an id, so the guard in `backendFor` cannot fire for
    // a well-typed caller. Asserted anyway, because the claim it makes — the
    // model gets a search rather than a crash — is worth being true at runtime
    // too, where the type's help is not available.
    useDeps({
      config: configFor(BRAVE_FIXTURE),
      fetchImpl: BRAVE_FIXTURE.answering(1),
      backendId: "not-a-backend" as unknown as SearchBackendId,
    })
    const result = await call({ query: "zod" })
    expect(result).toContain("Result 1")
  })

  it("hands one credential for a selected backend to that backend alone", async () => {
    // Brave's key is configured; Serper is named. Serper must not receive
    // Brave's key, and the absence must be Serper's, reported as such.
    const sink: RequestSink = {}
    useDeps({
      config: { apiKeys: {}, searchBackend: "serper", searchApiKeys: { brave: "brave-secret" } },
      fetchImpl: SERPER_FIXTURE.answering(1, sink),
    })
    const result = await call({ query: "zod" })
    expect(sink.url).toBeUndefined()
    expect(result).toContain('"serper"')
    expect(result).toMatch(/not an empty result/i)
  })
})
