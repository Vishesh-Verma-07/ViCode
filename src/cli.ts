#!/usr/bin/env bun

import React from "react"
import { render } from "ink"
import { parseArgs, formatHelp } from "./config/cli"
import { loadConfig } from "./config/config"
import { resolve } from "path"
import { readFileSync, existsSync } from "fs"
import { createOpenRouterProvider } from "./providers/openrouter"
import { assembleSystemPrompt } from "./core/system-prompt"
import { readOnlyTools } from "./tools"
import { CommandRegistry } from "./core/command-registry"
import { createBuiltinCommands } from "./commands"
import { App } from "./ui/app"
import {
  getSessionsDir,
  loadSession,
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

let initialSession: Session | null = null

const config = loadConfig({
  projectPath,
})

if (!config.apiKey) {
  console.error(
    "Error: No API key configured.\n\n" +
      "Set your OpenRouter API key in one of:\n" +
      "  1. ~/.vicode/config.json  → { \"apiKey\": \"your-key\" }\n" +
      "  2. .vicode.json in your project  → { \"apiKey\": \"your-key\" }\n" +
      "  3. Environment variable  → OPENROUTER_API_KEY=your-key\n\n" +
      "Get a key at https://openrouter.ai/keys"
  )
  process.exit(1)
}

const model = config.model ?? "anthropic/claude-sonnet-4"
log("component mounted ", model);

const apiKey: string = config.apiKey

const provider = createOpenRouterProvider({
  apiKey,
  model,
})

const systemPrompt = assembleSystemPrompt({
  projectPath,
  projectPrompt: config.systemPrompt,
  cliPrompt: undefined,
})

const commandRegistry = new CommandRegistry()
commandRegistry.registerAll(createBuiltinCommands(commandRegistry))

render(
  React.createElement(App, {
    provider,
    createProvider: (modelId: string) =>
      createOpenRouterProvider({
        apiKey,
        model: modelId,
      }),
    tools: readOnlyTools,
    systemPrompt,
    context: { projectPath },
    initialSession: initialSession ?? undefined,
    sessionsDir,
    commands: commandRegistry.getAll(),
  }),
)