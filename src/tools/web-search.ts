/**
 * `web_search`: the agent can ask the web a real question and get real answers
 * back.
 *
 * Written against the `SearchBackend` interface, so nothing here knows which
 * search API is behind it. The Tool resolves the search credential at the moment
 * of use and reports its absence there, because a missing search credential is
 * not the pre-chat gate a missing Provider key is: ViCode works fine without web
 * search, so blocking the Session up front would gate the app on a Tool the
 * user may never call.
 */
import { z } from "zod"
import type { ToolDefinition, ToolContext } from "../core/types"
import { HttpError } from "../core/http"
import { DEFAULT_SEARCH_BACKEND, getSearchBackend, isSearchBackendId } from "../core/search"
import { missingSearchCredentialMessage, searchCredentialFor } from "../core/search/credential"
import { SearchResponseShapeError } from "../core/search/types"
import type { SearchBackend, SearchBackendId, SearchResult } from "../core/search/types"
import type { AppConfig } from "../config/config"

/** How many results a call gets when it names no count of its own. */
export const DEFAULT_RESULT_COUNT = 5

/**
 * Overridable for tests, which is how a Tool Call's HTTP behaviour is asserted
 * without a network and without a real credential in the environment.
 */
export interface WebSearchDeps {
  /** The loaded config, for the Global Config credential. Absent in tests. */
  config?: AppConfig
  /** Which backend to resolve. Names an entry in the search registry. */
  backendId?: SearchBackendId
  fetchImpl?: typeof fetch
  timeoutMs?: number
}

let deps: WebSearchDeps = {}

/** Swaps the Tool's dependencies for a test, returning a restore function. */
export function setWebSearchDeps(next: WebSearchDeps): () => void {
  const previous = deps
  deps = next
  return () => {
    deps = previous
  }
}

/**
 * Resolves the backend through the registry, so the Tool names a backend id and
 * never a module. An id the registry does not hold falls back to the default
 * rather than throwing mid-Tool Call: the model asked for a search, and the most
 * useful answer to that is a search from the backend ViCode does have.
 */
function backendFor(): SearchBackend {
  const requested = deps.backendId
  return getSearchBackend(requested && isSearchBackendId(requested) ? requested : DEFAULT_SEARCH_BACKEND)
}

/** Clamps a caller-named count into the range the backend will serve. */
function clampCount(requested: unknown, max: number): number {
  const value = typeof requested === "number" && Number.isFinite(requested) ? requested : DEFAULT_RESULT_COUNT
  return Math.min(Math.max(Math.trunc(value), 1), max)
}

/**
 * Renders the ranked list. Every entry carries its title, its URL and a snippet:
 * enough for the model to reason from a source and to cite it, and enough for
 * the user to go and read it themselves.
 */
export function formatResults(query: string, results: SearchResult[]): string {
  const lines = [`${results.length} result(s) for "${query}", ranked:`, ""]
  results.forEach((result, index) => {
    lines.push(`${index + 1}. ${result.title}`)
    lines.push(`   ${result.url}`)
    lines.push(`   ${result.snippet || "(no snippet returned)"}`)
    if (index < results.length - 1) lines.push("")
  })
  lines.push("")
  lines.push("Snippets are excerpts, not full pages. Fetch a result's URL when you need the page itself.")
  return lines.join("\n")
}

/**
 * A search that matched nothing, said in words.
 *
 * Not an empty string: a model reads an empty result as a successful answer, and
 * then concludes there is nothing on the web about the question.
 */
export function noResultsMessage(query: string): string {
  return [
    `The search succeeded and matched nothing for "${query}".`,
    `This is an absence, not a failure — the request reached ${backendFor().label} and came back with no results.`,
    `Try different or broader terms; do not report this as an error.`,
  ].join("\n")
}

/**
 * States a failure as the failure it was, so the model can tell an absence from
 * a broken request and act on each differently.
 */
function failureMessage(query: string, backend: SearchBackend, error: unknown): string {
  const head = `web_search could not run "${query}". This is a failure, not an absence — no conclusion about whether anything on the web answers it.`

  if (error instanceof SearchResponseShapeError) {
    return [
      head,
      `Cause: the response was not shaped as expected. ${backend.label} answered, but the body did not parse as a result set, so its schema may have changed.`,
      `Do not retry the same query expecting a different answer.`,
    ].join("\n")
  }

  if (error instanceof HttpError) {
    switch (error.kind) {
      case "timeout":
        return [
          head,
          `Cause: the request timed out (${error.message}). The host did not answer in time.`,
          `A retry may succeed; the query was never actually run to completion.`,
        ].join("\n")
      case "status":
        return [
          head,
          `Cause: ${backend.label} refused the request — ${error.message}.`,
          statusAdvice(error.status),
        ].join("\n")
      case "malformed":
        return [
          head,
          `Cause: the response body was not valid JSON (${error.message}).`,
          `The request completed; the answer could not be read.`,
        ].join("\n")
      case "transport":
        return [
          head,
          `Cause: the network failed (${error.message}).`,
          `This is a connectivity or DNS fact, not a statement about the query. A retry may succeed.`,
        ].join("\n")
    }
  }

  return [head, `Cause: ${error instanceof Error ? error.message : String(error)}`].join("\n")
}

/** Turns a status into the action it implies, where one is knowable. */
function statusAdvice(status: number | null): string {
  if (status === 401 || status === 403) {
    return "The search credential was rejected. Check the key, or set a different one."
  }
  if (status === 429) {
    return "The credential's rate limit was reached. Wait before retrying; the query itself was fine."
  }
  if (status !== null && status >= 500) {
    return "The search service itself failed. Retrying later may succeed."
  }
  return "The search service refused the request."
}

export const webSearchTool: ToolDefinition = {
  name: "web_search",
  description:
    "Search the web and return ranked results, each with a title, a URL, and a snippet. Use for discovery — questions whose answer is not in the project. Snippets are excerpts, not pages; fetch a result's URL when you need the page itself.",
  parameters: z.object({
    query: z.string().describe("The search query"),
    numResults: z
      .number()
      .int()
      .min(1)
      .optional()
      .describe(`How many ranked results to return. Omit for ${DEFAULT_RESULT_COUNT}; the service caps it at 20.`),
  }),
  dangerous: false,
  execute: async (args, _context: ToolContext) => {
    const backend = backendFor()
    const query = args.query as string

    // Resolved at the moment of use rather than at startup: a missing search
    // credential must not gate the Session, so the absence is reported here,
    // to the one caller who asked for it, instead of up front to everyone.
    const credential = searchCredentialFor(deps.config ?? {}, backend)
    if (!credential) return missingSearchCredentialMessage(backend)

    const count = clampCount(args.numResults, backend.maxResults)
    try {
      const results = await backend.search(
        { query, count, credential },
        { fetchImpl: deps.fetchImpl, timeoutMs: deps.timeoutMs },
      )
      if (results.length === 0) return noResultsMessage(query)
      return formatResults(query, results)
    } catch (error) {
      return failureMessage(query, backend, error)
    }
  },
}