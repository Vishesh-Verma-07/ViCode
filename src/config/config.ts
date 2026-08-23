import { z } from "zod"
import { readFileSync, existsSync } from "fs"
import { join } from "path"

export const configSchema = z
  .object({
    apiKey: z.string().optional(),
    model: z.string().optional(),
    systemPrompt: z.string().optional(),
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

function cleanUndefined(obj: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(obj)) {
    if (value !== undefined) result[key] = value
  }
  return result
}
