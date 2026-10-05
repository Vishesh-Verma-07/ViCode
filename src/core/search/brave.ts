/**
 * The Brave Search backend.
 *
 * Written against the `SearchBackend` interface and against Brave's own response
 * shape only inside this file, so a different vendor is a new module rather than
 * a change to the Tool.
 */
import { httpRequestJson } from "../http"
import {
  SearchResponseShapeError,
  type SearchBackend,
  type SearchRequest,
  type SearchRequestOptions,
  type SearchResult,
} from "./types"

export const BRAVE_SEARCH_URL = "https://api.search.brave.com/res/v1/web/search"

/** Brave rejects a `count` above this rather than returning more. */
export const BRAVE_MAX_RESULTS = 20

/**
 * One entry of Brave's `web.results` array, read field by field.
 *
 * Parsed as `unknown` and narrowed by hand rather than cast: an entry missing
 * its title or URL is dropped, and a payload that is not a result set at all
 * fails as a shape error, instead of either crashing or reading as an answer.
 */
function parseResult(raw: unknown): SearchResult | null {
  if (typeof raw !== "object" || raw === null) return null
  const entry = raw as Record<string, unknown>

  const { title, url, description } = entry
  if (typeof title !== "string" || title === "") return null
  if (typeof url !== "string" || url === "") return null

  return {
    title,
    url,
    // Brave documents `description` as nullable, so a result carrying none is
    // still ranked, with an empty snippet rather than dropped from the list.
    snippet: typeof description === "string" ? description : "",
  }
}

/**
 * Reads a Brave response into ranked results.
 *
 * `null` means the payload is not shaped the way Brave documents — distinct
 * from an empty array, which means the search matched nothing. A `results` array
 * that holds entries none of which can be read counts as `null` too: Brave did
 * not answer "nothing matches this", it answered with rows that are not results,
 * and reporting that as an absence would turn a schema change into a quiet lie.
 */
export function parseBraveResponse(payload: unknown): SearchResult[] | null {
  if (typeof payload !== "object" || payload === null) return null
  const web = (payload as Record<string, unknown>).web
  if (typeof web !== "object" || web === null) return null
  const results = (web as Record<string, unknown>).results
  if (!Array.isArray(results)) return null

  const parsed: SearchResult[] = []
  for (const raw of results) {
    const result = parseResult(raw)
    if (result) parsed.push(result)
  }
  if (parsed.length === 0 && results.length > 0) return null
  return parsed
}

export const BRAVE_BACKEND: SearchBackend = {
  id: "brave",
  label: "Brave Search",
  keyUrl: "https://brave.com/search/api/",
  nativeEnv: "BRAVE_SEARCH_API_KEY",
  maxResults: BRAVE_MAX_RESULTS,

  async search(request: SearchRequest, options: SearchRequestOptions = {}): Promise<SearchResult[]> {
    const url = new URL(BRAVE_SEARCH_URL)
    url.searchParams.set("q", request.query)
    url.searchParams.set("count", String(request.count))

    const { json } = await httpRequestJson(url.toString(), {
      fetchImpl: options.fetchImpl,
      timeoutMs: options.timeoutMs,
      headers: {
        Accept: "application/json",
        // Brave authenticates with a custom header rather than a bearer token.
        // This is a search credential, and it is not a Provider key.
        "X-Subscription-Token": request.credential,
      },
    })

    const results = parseBraveResponse(json)
    if (results === null) {
      throw new SearchResponseShapeError(`${BRAVE_BACKEND.label} returned a response that is not a search result set`)
    }
    return results.slice(0, request.count)
  },
}