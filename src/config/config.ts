import { z } from "zod"
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "fs"
import { join, dirname } from "path"
import { isProviderId, providerEnvVars, type ProviderId } from "../core/providers"
import { LEGACY_PROVIDER, qualifyStoredModel, isLegacyModelValue } from "../core/model-id"

export const configSchema = z
  .object({
    /**
     * On-disk format version. A config without it predates provider
     * qualification, so its `model` can only have meant OpenRouter — the same
     * collision `openai/gpt-4o` would otherwise hit. See model-id.ts.
     */
    version: z.number().optional(),
    /**
     * Legacy single key. Kept readable so an existing global config keeps
     * working; it is normalised into `apiKeys[openrouter]` on load.
     */
    apiKey: z.string().optional(),
    /** One key per Provider, keyed by Provider id. */
    apiKeys: z.record(z.string(), z.string()).optional(),
    /** Canonical `provider/model` id. Unqualified ids are read as OpenRouter. */
    model: z.string().optional(),
    systemPrompt: z.string().optional(),
    sensitiveFiles: z.array(z.string()).optional(),
    silentBashCommands: z.array(z.string()).optional(),
  })
  .strict()

export type AppConfig = Omit<
  z.infer<typeof configSchema>,
  "apiKey" | "apiKeys" | "version"
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
 * Collects configured keys into one map, dropping any entry that is not a
 * Provider in the registry so a stale key cannot masquerade as a valid route.
 */
function collectKeys(...layers: (z.infer<typeof configSchema> | undefined)[]): Partial<Record<ProviderId, string>> {
  const keys: Partial<Record<ProviderId, string>> = {}
  for (const layer of layers) {
    if (!layer) continue
    // The legacy single key belongs to OpenRouter, the only Provider that
    // existed when it could have been written.
    if (layer.apiKey) keys[LEGACY_PROVIDER] = layer.apiKey
    if (layer.apiKeys) {
      for (const [id, value] of Object.entries(layer.apiKeys)) {
        if (isProviderId(id) && typeof value === "string" && value !== "") keys[id] = value
      }
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

  const globalRaw = readJsonFile(globalConfigPath)
  const globalConfig = globalRaw ? configSchema.parse(globalRaw) : {}

  const projectFile = join(projectPath, ".vicode.json")
  const projectRaw = readJsonFile(projectFile)
  const projectConfig = projectRaw ? configSchema.parse(projectRaw) : {}

  // The winning layer carries its own version, because a model id is only
  // unambiguous relative to the format it was written in.
  const rawModel = projectConfig.model ?? globalConfig.model
  const rawModelSource = projectConfig.model !== undefined ? projectConfig : globalConfig

  // Config layering: project overrides global; no CLI layer
  const merged: AppConfig = {
    model:
      rawModel === undefined
        ? undefined
        : qualifyStoredModel(rawModel, isLegacyModelValue(rawModelSource)),
    systemPrompt: projectConfig.systemPrompt ?? globalConfig.systemPrompt,
    apiKeys: collectKeys(globalConfig, projectConfig),
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
    const merged = mutate(existing)
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