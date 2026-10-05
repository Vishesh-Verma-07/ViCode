/**
 * The backends that can exist. The registry is keyed by these, so adding one is
 * a single entry here plus its implementation.
 */
export const SEARCH_BACKEND_IDS = ["brave"] as const

export type SearchBackendId = (typeof SEARCH_BACKEND_IDS)[number]

/**
 * One ranked search result, in the terms every search API agrees on: a title to
 * show, a URL to cite, and a snippet of what the page says. The Tool renders
 * these; it does not know which fields any one backend calls them.
 */
export interface SearchResult {
  title: string
  url: string
  snippet: string
}

/**
 * A search backend: a query in, ranked results out.
 *
 * Deliberately not a Provider. A Provider is a route ViCode chats through and
 * bills per token; a search backend answers a query, is never selectable as a
 * route, and appears in no cost accounting. A credential for one is a network
 * credential, held in its own config field rather than in the Provider key map.
 */
export interface SearchBackend {
  /** Its own stable id, and the value a selection field takes. */
  readonly id: SearchBackendId
  /** Human-facing name, for help and for the "which backend" message. */
  readonly label: string
  /** Where a user obtains this backend's credential. */
  readonly keyUrl: string
  /**
   * The variable name native to this backend's own tooling. The namespaced
   * `VICODE_`-prefixed override is derived from it rather than declared, so the
   * two cannot drift apart (ADR-0010).
   */
  readonly nativeEnv: string
  /** How many results the API will return at most, so the Tool can say so. */
  readonly maxResults: number
  /**
   * Runs one query. Rejects with an `HttpError` for a transport, timeout,
   * status or malformed-body failure, and returns an empty array for a query
   * that genuinely matched nothing — the difference the model needs to tell an
   * absence from a failure. A body that parses but is not a result set rejects
   * with a `SearchResponseShapeError`.
   */
  search(request: SearchRequest, options?: SearchRequestOptions): Promise<SearchResult[]>
}

/**
 * A response that arrived, was authenticated, and is still not a result set.
 *
 * Its own type, distinct from `HttpError`'s malformed kind, because the two
 * demand different responses: a body of invalid JSON is a fact about the wire
 * format, whereas a well-formed JSON answer of the wrong shape is the response
 * schema having moved under us — a bug on our side of the boundary, not a
 * transient fault a retry would clear. It lives here rather than in any backend
 * so a caller can catch the condition without naming a vendor.
 */
export class SearchResponseShapeError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "SearchResponseShapeError"
  }
}

export interface SearchRequest {
  query: string
  /** How many results to return, already clamped to the backend's ceiling. */
  count: number
  /**
   * The credential this backend authenticates with. It arrives as an argument
   * rather than being read from the environment inside the backend, so a
   * backend never reaches for a global and every call states what it used.
   */
  credential: string
}

/**
 * The transport seam, mirroring the Model Catalog's fetch-shaped override: a
 * test exercises a backend's request and response handling without a network.
 */
export interface SearchRequestOptions {
  fetchImpl?: typeof fetch
  timeoutMs?: number
}