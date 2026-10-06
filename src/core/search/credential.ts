/**
 * The search credential: the key that authenticates `web_search`, and nothing
 * else.
 *
 * It is not an API Key in this codebase's sense — that word is spoken for by a
 * Provider credential, and conflating the two is how a search key ends up in
 * the Provider picker, the Route Label and cost accounting. It therefore never
 * travels through the Provider key map, which drops any entry that is not a
 * Provider id and would silently discard it.
 *
 * Resolution follows the Namespaced API Key rule exactly: the Global Config
 * field first, then `VICODE_`-prefixed environment variable, then the backend's
 * own native variable. The native name still authenticates alone, so the
 * override stays an option rather than a second copy of the secret to maintain.
 */
import { namespacedEnvVar } from "../providers"
import { DEFAULT_SEARCH_BACKEND, getSearchBackend, type SearchBackend } from "./index"
import { SEARCH_CREDENTIAL_FIELD, type AppConfig } from "../../config/config"

/**
 * The variables a search credential is read from, highest precedence first: the
 * namespaced override, then the backend's own native name.
 *
 * The namespaced name comes from the same derivation every Provider's does, so
 * the override cannot drift from the name it shadows (ADR-0010). A two-entry
 * tuple rather than an array, so a caller that destructures the pair gets two
 * strings rather than two maybe-strings.
 */
export function searchEnvVars(backend: SearchBackend): [string, string] {
  return [namespacedEnvVar(backend.nativeEnv), backend.nativeEnv]
}

/**
 * The credential for a backend, or undefined when none is configured.
 *
 * Takes anything carrying a `searchApiKey`, so the Tool can resolve against a
 * loaded config or against no config at all — in which case the environment
 * variables still apply, which is what makes the env route work with no Global
 * Config file present.
 */
export function searchCredentialFor(
  config: Pick<AppConfig, "searchApiKey">,
  backend: SearchBackend = getSearchBackend(DEFAULT_SEARCH_BACKEND),
): string | undefined {
  const configured = config.searchApiKey
  if (configured) return configured
  for (const envVar of searchEnvVars(backend)) {
    const value = process.env[envVar]
    if (value) return value
  }
  return undefined
}

/**
 * What to tell a model that called `web_search` with no credential configured.
 *
 * Names the credential and how to set it, because a Tool Result the model cannot
 * act on is the same failure as one that says nothing. Distinct from every other
 * outcome: this is ViCode not being set up, not a search that found nothing.
 */
export function missingSearchCredentialMessage(backend: SearchBackend): string {
  const [namespaced, native] = searchEnvVars(backend)
  return [
    `web_search is not configured: no search credential is set, so no search was run.`,
    `This is a missing credential, not an empty result.`,
    `Set it one of these ways:`,
    `- add "${SEARCH_CREDENTIAL_FIELD}" to ~/.vicode/config.json, the Global Config (e.g. { "${SEARCH_CREDENTIAL_FIELD}": "your-key" })`,
    `- export ${namespaced} in the environment, which overrides ${native} for ViCode alone`,
    `- export ${native}, which ${backend.label} reads on its own`,
    `Get a ${backend.label} key at ${backend.keyUrl}`,
  ].join("\n")
}