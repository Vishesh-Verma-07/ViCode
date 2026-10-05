/**
 * The search backend seam: a query in, ranked results out.
 *
 * The Tool above it knows nothing about any vendor. It hands over a query and a
 * result count and gets back entries carrying a title, a URL and a snippet —
 * which is what a search result *is*, as opposed to what one API happens to call
 * it. Choosing a different provider is a matter of adding an implementation of
 * this interface, not of unwiring a vendor-coupled Tool.
 */
import type { SearchBackend, SearchBackendId, SearchRequest, SearchResult } from "./types"
import { BRAVE_BACKEND } from "./brave"

export type { SearchBackend, SearchBackendId, SearchRequest, SearchResult }

/**
 * The backends that exist, keyed by id. One ships; the map is what makes the
 * next one additive rather than a rewrite.
 */
export const SEARCH_BACKENDS: Record<SearchBackendId, SearchBackend> = {
  brave: BRAVE_BACKEND,
}

/** The backend a query runs against when nothing else was named. */
export const DEFAULT_SEARCH_BACKEND: SearchBackendId = "brave"

export function listSearchBackends(): SearchBackend[] {
  return Object.values(SEARCH_BACKENDS)
}

export function isSearchBackendId(value: string): value is SearchBackendId {
  return value in SEARCH_BACKENDS
}

export function getSearchBackend(id: SearchBackendId): SearchBackend {
  return SEARCH_BACKENDS[id]
}