import { z } from "zod"
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "fs"
import { join, dirname } from "path"

export const configSchema = z
  .object({
    apiKey: z.string().optional(),
    model: z.string().optional(),
    systemPrompt: z.string().optional(),
    sensitiveFiles: z.array(z.string()).optional(),
    silentBashCommands: z.array(z.string()).optional(),
  })
  .strict()

export type AppConfig = z.infer<typeof configSchema>

interface LoadConfigOptions {
  projectPath: string
  globalConfigPath?: string
  cliArgs?: Partial<AppConfig>
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

export function loadConfig(options: LoadConfigOptions): AppConfig {
  const {
    projectPath,
    globalConfigPath = joinHomePath(".vicode/config.json"),
    cliArgs = {},
  } = options

  const globalRaw = readJsonFile(globalConfigPath)
  const globalConfig = globalRaw ? configSchema.parse(globalRaw) : {}

  const projectFile = join(projectPath, ".vicode.json")
  const projectRaw = readJsonFile(projectFile)
  const projectConfig = projectRaw ? configSchema.parse(projectRaw) : {}

  // Config layering: project overrides global; no CLI layer
  const merged: AppConfig = {
    ...globalConfig,
    ...projectConfig,
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

  if (!merged.apiKey) {
    const envKey = process.env.OPENROUTER_API_KEY
    if (envKey) merged.apiKey = envKey
  }

  return merged
}

function joinHomePath(relativePath: string): string {
  const home = process.env.HOME || process.env.USERPROFILE || ""
  return home ? `${home}/${relativePath}` : ""
}

/**
 * Persists an API key to the global config (~/.vicode/config.json),
 * merging with any existing global settings. Best-effort: returns false
 * when the write fails so callers can surface the failure.
 */
export function saveApiKeyToGlobalConfig(
  apiKey: string,
  globalConfigPath = joinHomePath(".vicode/config.json"),
): boolean {
  try {
    const existing = readJsonFile(globalConfigPath) ?? {}
    const merged = { ...existing, apiKey }
    mkdirSync(dirname(globalConfigPath), { recursive: true })
    writeFileSync(globalConfigPath, JSON.stringify(merged, null, 2) + "\n", "utf-8")
    return true
  } catch {
    return false
  }
}

function cleanUndefined(obj: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(obj)) {
    if (value !== undefined) result[key] = value
  }
  return result
}

/**
 * Removes the API key from the global config (~/.vicode/config.json), keeping
 * every other field intact. Returns false when there was no key to remove or
 * the write failed, so callers can surface the outcome.
 */
export function removeApiKeyFromGlobalConfig(
  globalConfigPath = joinHomePath(".vicode/config.json"),
): boolean {
  try {
    const existing = readJsonFile(globalConfigPath)
    if (!existing || !("apiKey" in existing)) return false
    delete existing.apiKey
    mkdirSync(dirname(globalConfigPath), { recursive: true })
    writeFileSync(globalConfigPath, JSON.stringify(existing, null, 2) + "\n", "utf-8")
    return true
  } catch {
    return false
  }
}
