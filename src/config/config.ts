import { z, type ZodError } from "zod"
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "fs"
import { join, dirname } from "path"
import { isProviderId, providerEnvVars, type ProviderId } from "../core/providers"
import {
  LEGACY_PROVIDER,
  qualifyStoredModel,
  isLegacyModelValue,
  renameModelFormatMarker,
} from "../core/model-id"

/** The fields both config layers accept. An API Key is not among them. */
const configLayerFields = {
  /**
   * On-disk format version. A config without it predates provider
   * qualification, so its `model` can only have meant OpenRouter — the same
   * collision `openai/gpt-4o` would otherwise hit. See model-id.ts.
   */
  modelFormatVersion: z.number().optional(),
  /**
   * The marker's original field name, kept readable because the schema is
   * strict: dropping it would fail to parse every config the current release
   * wrote. Reads as the marker; the global config is rewritten under
   * `modelFormatVersion` the next time it is saved (issue #86).
   */
  version: z.number().optional(),
  /** Canonical `provider/model` id. Unqualified ids are read as OpenRouter. */
  model: z.string().optional(),
  systemPrompt: z.string().optional(),
  sensitiveFiles: z.array(z.string()).optional(),
  silentBashCommands: z.array(z.string()).optional(),
}

/**
 * The Global Config field the search credential is written to.
 *
 * Declared here, beside the schema that reads it, so the wire name has one home:
 * the search module names this constant rather than restating the string, and
 * the two cannot drift. It is deliberately not an entry in the Provider key map,
 * which discards any entry that is not a Provider id (issue #93).
 */
export const SEARCH_CREDENTIAL_FIELD = "searchApiKey"

/**
 * The Global Config: the only layer that holds an API Key, because a key is a
 * credential rather than a configuration choice and `~/.vicode/config.json` is
 * the file kept out of version control.
 */
export const globalConfigSchema = z
  .object({
    ...configLayerFields,
    /**
     * Legacy single key. Kept readable so an existing global config keeps
     * working; it is normalised into `apiKeys[openrouter]` on load.
     */
    apiKey: z.string().optional(),
    /** One key per Provider, keyed by Provider id. */
    apiKeys: z.record(z.string(), z.string()).optional(),
    /**
     * The search credential `web_search` authenticates with — its own field,
     * because the Provider key map discards any entry that is not a Provider id
     * and would silently drop it. A network credential, not a route you chat
     * through, so it never appears in the Provider picker, the Route Label or
     * cost accounting, and a Project Config refuses it (issue #93).
     */
    [SEARCH_CREDENTIAL_FIELD]: z.string().optional(),
  })
  .strict()

/**
 * The Project Config, which carries no key at all — deliberately, and refused
 * rather than quietly ignored. `.vicode.json` is a file meant to be committed,
 * so a credential written there is a leaked one however the loader treats it;
 * and ignoring it silently would leave the user with a Provider that has no key
 * and no explanation. Naming the field is the useful answer: they learn which
 * one to move, and `/key` writes it where it belongs (issue #87).
 */
export const projectConfigSchema = z.object(configLayerFields).strict()

export type AppConfig = Omit<
  z.infer<typeof globalConfigSchema>,
  "apiKey" | "apiKeys" | "version" | "modelFormatVersion"
> & {
  /** Every configured key, keyed by Provider id. Always present, maybe empty. */
  apiKeys: Partial<Record<ProviderId, string>>
  /** The canonical model id, resolved from whichever layer won. */
  model?: string
}

interface LoadConfigOptions {
  projectPath: string
  globalConfigPath?: string
}

/** Fields the strict schema refused, which is the whole of an unknown-key error. */
function unknownFieldsOf(error: ZodError): string[] {
  return error.issues.flatMap((issue) =>
    "keys" in issue && Array.isArray(issue.keys) ? (issue.keys as string[]) : [],
  )
}

/**
 * Every issue in one line each, naming the field it is about.
 *
 * All of them, not the first: a file with an unknown key *and* a mistyped one
 * would otherwise be reported once per run, sending the user back to fix a
 * second error they were never shown. A type issue carries its field in `path`,
 * so the field is named rather than left to "expected string, received number"
 * — which says what was wanted but not what to change.
 */
function describeIssues(issues: ZodError["issues"]): string {
  return issues
    .map((issue) => {
      if ("keys" in issue && Array.isArray(issue.keys)) {
        return `unrecognised field${issue.keys.length > 1 ? "s" : ""} ${issue.keys.join(", ")}`
      }
      const field = issue.path.length > 0 ? issue.path.join(".") : "the file"
      return `${field} ${issue.message}`
    })
    .join("; ")
}

/**
 * A config file the loader refused, naming which file it was. The schema's own
 * error says what is wrong with the contents but not which file, and the two
 * layers are read by different rules — only a project config refuses an API Key
 * — so the caller cannot give advice without knowing the path (issue #87).
 */
export class ConfigError extends Error {
  readonly path: string
  readonly issues: ZodError["issues"]
  readonly unknownFields: string[]

  constructor(path: string, error: ZodError) {
    super(`${path}: ${describeIssues(error.issues)}`)
    this.name = "ConfigError"
    this.path = path
    this.issues = error.issues
    this.unknownFields = unknownFieldsOf(error)
  }

  /** Every credential field, in either schema's vocabulary. */
  private static readonly CREDENTIAL_FIELDS = ["apiKey", "apiKeys", "searchApiKey"]

  /**
   * True when a credential is what the file was refused for. Covers the search
   * credential too: it is refused from a Project Config for the same reason an
   * API Key is, so the caller should give credential advice either way rather
   * than quoting the wrong file.
   */
  get refusesApiKey(): boolean {
    return this.unknownFields.some((field) => ConfigError.CREDENTIAL_FIELDS.includes(field))
  }

  /** The credential fields this file was refused for, for advice that names them. */
  get refusedCredentialFields(): string[] {
    return this.unknownFields.filter((field) => ConfigError.CREDENTIAL_FIELDS.includes(field))
  }
}

function parseConfigFile<T extends z.ZodType>(path: string, schema: T): z.infer<T> {
  const raw = readJsonFile(path)
  if (!raw) return {} as z.infer<T>
  const parsed = schema.safeParse(raw)
  if (!parsed.success) throw new ConfigError(path, parsed.error)
  return parsed.data
}

function readJsonFile(path: string): Record<string, unknown> | null {
  if (!existsSync(path)) return null
  try {
    const raw = readFileSync(path, "utf-8")
    return JSON.parse(raw) as Record<string, unknown>
  } catch {
    return null
  }
}

/**
 * Collects the Global Config's keys into one map, dropping any entry that is not
 * a Provider in the registry so a stale key cannot masquerade as a valid route.
 *
 * Only the global layer is consulted. The Project Config has no key fields to
 * read, so this is not a merge that happens to prefer one layer — there is
 * nothing for a project key to win with (issue #87).
 */
function collectKeys(globalConfig: z.infer<typeof globalConfigSchema>): Partial<Record<ProviderId, string>> {
  const keys: Partial<Record<ProviderId, string>> = {}
  // The legacy single key belongs to OpenRouter, the only Provider that
  // existed when it could have been written.
  if (globalConfig.apiKey) keys[LEGACY_PROVIDER] = globalConfig.apiKey
  if (globalConfig.apiKeys) {
    for (const [id, value] of Object.entries(globalConfig.apiKeys)) {
      if (isProviderId(id) && typeof value === "string" && value !== "") keys[id] = value
    }
  }
  return keys
}

/**
 * The key for a Provider: the configured one, else the first environment
 * variable that Provider accepts, in the order the registry declares
 * (ADR-0010). OpenCode Zen and Go deliberately share `OPENCODE_API_KEY` and its
 * namespaced override, so setting either authenticates both.
 */
export function keyForProvider(
  config: AppConfig,
  provider: ProviderId,
): string | undefined {
  const configured = config.apiKeys[provider]
  if (configured) return configured
  for (const envVar of providerEnvVars(provider)) {
    const value = process.env[envVar]
    if (value) return value
  }
  return undefined
}

export function loadConfig(options: LoadConfigOptions): AppConfig {
  const {
    projectPath,
    globalConfigPath = joinHomePath(".vicode/config.json"),
  } = options

  const globalConfig = parseConfigFile(globalConfigPath, globalConfigSchema)

  // Parsed by the Project Config schema, which has no key fields: a credential
  // in a file meant to be committed is refused by name rather than read.
  const projectFile = join(projectPath, ".vicode.json")
  const projectConfig = parseConfigFile(projectFile, projectConfigSchema)

  // The winning layer carries its own format marker, because a model id is only
  // unambiguous relative to the format it was written in.
  const rawModel = projectConfig.model ?? globalConfig.model
  const rawModelSource = projectConfig.model !== undefined ? projectConfig : globalConfig

  // Config layering: project overrides global; no CLI layer. Keys are the one
  // setting with no project half to layer, since it carries none.
  const merged: AppConfig = {
    model:
      rawModel === undefined
        ? undefined
        : qualifyStoredModel(rawModel, isLegacyModelValue(rawModelSource)),
    systemPrompt: projectConfig.systemPrompt ?? globalConfig.systemPrompt,
    apiKeys: collectKeys(globalConfig),
  }

  // Only the Global Config has a credential field for search, so there is no
  // project half to layer and nothing to merge.
  if (globalConfig.searchApiKey) {
    merged.searchApiKey = globalConfig.searchApiKey
  }

  // sensitiveFiles merges across layers instead of overriding
  if (globalConfig.sensitiveFiles || projectConfig.sensitiveFiles) {
    merged.sensitiveFiles = [
      ...(globalConfig.sensitiveFiles ?? []),
      ...(projectConfig.sensitiveFiles ?? []),
    ]
  }

  // silentBashCommands merges across layers instead of overriding
  if (globalConfig.silentBashCommands || projectConfig.silentBashCommands) {
    merged.silentBashCommands = [
      ...(globalConfig.silentBashCommands ?? []),
      ...(projectConfig.silentBashCommands ?? []),
    ]
  }

  return merged
}

function joinHomePath(relativePath: string): string {
  const home = process.env.HOME || process.env.USERPROFILE || ""
  return home ? `${home}/${relativePath}` : ""
}

function writeGlobalConfig(
  mutate: (existing: Record<string, unknown>) => Record<string, unknown>,
  globalConfigPath: string,
): boolean {
  try {
    const existing = readJsonFile(globalConfigPath) ?? {}
    // Renamed rather than stamped, so a config predating qualification keeps
    // reading as such. Only the global config has a writer, so a project
    // `.vicode.json` keeps the old field name for as long as it lives and is
    // read through `isLegacyModelValue` throughout (issue #86).
    const merged = mutate(renameModelFormatMarker(existing))
    mkdirSync(dirname(globalConfigPath), { recursive: true })
    writeFileSync(globalConfigPath, JSON.stringify(merged, null, 2) + "\n", "utf-8")
    return true
  } catch {
    return false
  }
}

/**
 * Persists one Provider's API key to the global config, leaving the other
 * Providers' keys and every non-key setting intact. Best-effort: returns false
 * when the write fails so callers can surface the failure.
 */
export function saveApiKeyToGlobalConfig(
  provider: ProviderId,
  apiKey: string,
  globalConfigPath = joinHomePath(".vicode/config.json"),
): boolean {
  return writeGlobalConfig((existing) => {
    const keys = (existing.apiKeys as Record<string, string> | undefined) ?? {}
    const next = { ...keys, [provider]: apiKey }
    // The legacy top-level key would shadow the map on the next load.
    delete existing.apiKey
    return { ...existing, apiKeys: next }
  }, globalConfigPath)
}

/**
 * Removes one Provider's key from the global config, keeping every other key
 * and setting intact. Returns false when there was no key to remove or the
 * write failed.
 */
export function removeApiKeyFromGlobalConfig(
  provider: ProviderId,
  globalConfigPath = joinHomePath(".vicode/config.json"),
): boolean {
  const existing = readJsonFile(globalConfigPath)
  if (!existing) return false

  const keys = existing.apiKeys as Record<string, string> | undefined
  const hadMapped = keys !== undefined && provider in keys
  const hadLegacy = provider === LEGACY_PROVIDER && "apiKey" in existing
  if (!hadMapped && !hadLegacy) return false

  return writeGlobalConfig((current) => {
    const currentKeys = current.apiKeys as Record<string, string> | undefined
    if (currentKeys) delete currentKeys[provider]
    delete current.apiKey
    if (currentKeys && Object.keys(currentKeys).length === 0) delete current.apiKeys
    return current
  }, globalConfigPath)
}