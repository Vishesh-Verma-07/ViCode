import { setWebFetchDeps, type WebFetchDeps } from "./web-fetch"

export function setWebFetchDepsForTest(deps: WebFetchDeps): () => void {
  return setWebFetchDeps(deps)
}
