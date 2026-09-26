import React from "react"
import { render } from "ink"
import { parseArgs, formatHelp } from "./config/cli"
import { loadConfig, saveApiKeyToGlobalConfig, removeApiKeyFromGlobalConfig } from "./config/config"
import { resolve } from "path"
import { readFileSync, existsSync } from "fs"
import { createOpenRouterProvider } from "./providers/openrouter"
import { allTools } from "./tools"
import { CommandRegistry } from "./core/command-registry"
import { createBuiltinCommands } from "./commands"
import { App } from "./ui/app"
import { createBackspaceRewritingStdin } from "./ui/backspace-encoding"
import {
  getSessionsDir,
  loadLatestSession,
  type Session,
} from "./core/session"
import { log } from "./utils/logger"

const args = parseArgs(process.argv.slice(2))

if (args.help) {
  console.log(formatHelp())
  process.exit(0)
}

const projectPath = args.directory ? resolve(args.directory) : process.cwd()

const envPath = resolve(projectPath, ".env")
if (existsSync(envPath)) {
  const envContent = readFileSync(envPath, "utf-8")
  for (const line of envContent.split("\n")) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith("#")) continue
    const eqIdx = trimmed.indexOf("=")
    if (eqIdx === -1) continue
    const key = trimmed.slice(0, eqIdx).trim()
    const value = trimmed.slice(eqIdx + 1).trim()
    if (!process.env[key]) {
      process.env[key] = value
    }
  }
}

const sessionsDir = getSessionsDir(projectPath)

const initialSession: Session | null = loadLatestSession(projectPath)

const config = loadConfig({
  projectPath,
})

const apiKey: string = config.apiKey ?? ""

const model = config.model ?? "nvidia/nemotron-3-ultra-550b-a55b:free"
log("component mounted ", model);

const provider = createOpenRouterProvider({
  apiKey,
  model,
})

const createProvider = (modelId: string, key = apiKey) =>
  createOpenRouterProvider({
    apiKey: key,
    model: modelId,
  })

const commandRegistry = new CommandRegistry()
commandRegistry.registerAll(createBuiltinCommands(commandRegistry))

render(
  React.createElement(App, {
    provider,
    createProvider,
    tools: allTools,
    projectPrompt: config.systemPrompt,
    context: { projectPath, sensitivePatterns: config.sensitiveFiles, silentBashCommands: config.silentBashCommands },
    initialSession: initialSession ?? undefined,
    sessionsDir,
    commands: commandRegistry.getAll(),
    initialApiKey: apiKey,
    onSaveApiKey: (key: string) => {
      saveApiKeyToGlobalConfig(key)
    },
    onRemoveApiKey: () => {
      removeApiKeyFromGlobalConfig()
    },
  }),
  { stdin: createBackspaceRewritingStdin(process.stdin) },
)