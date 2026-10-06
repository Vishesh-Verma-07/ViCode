/**
 * The Serper backend: Google's results through serper.dev.
 *
 * Written against the `SearchBackend` interface and against Serper's own
 * response shape only inside this file. Its wire format has almost nothing in
 * common with Brave's — a POST body rather than query parameters, a key header
 * rather than a subscription token, `organic[].link` rather than
 * `web.results[].url` — which is the point: the seam holds across backends
 * that disagree on every one of those choices.
 */
import { httpRequestJson } from "../http"
import {
  SearchResponseShapeError,
  type SearchBackend,
  type SearchRequest,
  type SearchRequestOptions,
  type SearchResult,
} from "./types"

export const SERPER_SEARCH_URL = "https://google.serper.dev/search"

/** Serper rejects a `num` above this rather than returning more. */
export const SERPER_MAX_RESULTS = 100

/**
 * The keys Serper puts in an answer, whether or not it has organic results.
 *
 * Used to tell "Serper answered and matched nothing" from "this body is not a
 * Serper answer at all": an echo of the search parameters is proof the request
 * ran, while a body carrying neither it nor any of the rest is not something
 * this backend knows how to read.
 */
const SERPER_ANSWER_KEYS = [
  "searchParameters",
  "answerBox",
  "knowledgeGraph",
  "peopleAlsoAsk",
  "relatedSearches",
]

/**
 * One entry of Serper's `organic` array, read field by field.
 *
 * Parsed as `unknown` and narrowed by hand rather than cast: an entry missing
 * its title or link is dropped, and a payload that is not a result set at all
 * fails as a shape error, instead of either crashing or reading as an answer.
 */
function parseResult(raw: unknown): SearchResult | null {
  if (typeof raw !== "object" || raw === null) return null
  const entry = raw as Record<string, unknown>

  const { title, link, snippet } = entry
  if (typeof title !== "string" || title === "") return null
  if (typeof link !== "string" || link === "") return null

  return {
    title,
    url: link,
    // A result carrying no snippet is still ranked, with an empty snippet
    // rather than dropped from the list.
    snippet: typeof snippet === "string" ? snippet : "",
  }
}

/**
 * Reads a Serper response into ranked results.
 *
 * `null` means the payload is not shaped the way Serper documents — distinct
 * from an empty array, which means the search matched nothing. Serper models
 * `organic` as optional, so an answer that carries only its echoed search
 * parameters is an answer with no organic results; a body that is not a Serper
 * answer at all is neither of those and fails as a shape error. A non-empty
 * `organic` holding entries none of which can be read counts as `null` too:
 * Serper did not answer "nothing matches this", it answered with rows that are
 * not results, and reporting that as an absence would turn a schema change
 * into a quiet lie.
 */
export function parseSerperResponse(payload: unknown): SearchResult[] | null {
  if (typeof payload !== "object" || payload === null) return null
  const answer = payload as Record<string, unknown>

  const organic = answer.organic
  if (organic === undefined) {
    return SERPER_ANSWER_KEYS.some((key) => key in answer) ? [] : null
  }
  if (!Array.isArray(organic)) return null

  const parsed: SearchResult[] = []
  for (const raw of organic) {
    const result = parseResult(raw)
    if (result) parsed.push(result)
  }
  if (parsed.length === 0 && organic.length > 0) return null
  return parsed
}

export const SERPER_BACKEND: SearchBackend = {
  id: "serper",
  label: "Serper",
  keyUrl: "https://serper.dev/",
  nativeEnv: "SERPER_API_KEY",
  maxResults: SERPER_MAX_RESULTS,

  async search(request: SearchRequest, options: SearchRequestOptions = {}): Promise<SearchResult[]> {
    const { json } = await httpRequestJson(SERPER_SEARCH_URL, {
      method: "POST",
      fetchImpl: options.fetchImpl,
      timeoutMs: options.timeoutMs,
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        // Serper authenticates with its own header rather than a bearer token.
        // This is a search credential, and it is not a Provider key.
        "X-API-KEY": request.credential,
      },
      body: JSON.stringify({ q: request.query, num: request.count }),
    })

    const results = parseSerperResponse(json)
    if (results === null) {
      throw new SearchResponseShapeError(`${SERPER_BACKEND.label} returned a response that is not a search result set`)
    }
    return results.slice(0, request.count)
  },
}
