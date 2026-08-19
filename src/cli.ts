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
import { App } from "./ui/app"
import {
  getSessionsDir,
  listSessions,
  loadSession,
  loadLatestSession,
  type Session,
} from "./core/session"

const args = parseArgs(process.argv.slice(2))

if (args.help) {
  console.log(formatHelp())
  process.exit(0)
}

const projectPath = args.directory ? resolve(args.directory) : process.cwd()
const sessionsDir = getSessionsDir(projectPath)

if (args.sessions) {
  const sessions = listSessions(sessionsDir)
  if (sessions.length === 0) {
    console.log("No sessions found for this project.")
  } else {
    console.log(`Sessions for ${projectPath}:\n`)
    for (const s of sessions) {
      const date = new Date(s.updatedAt).toLocaleString()
      console.log(
        `  ${s.id}  ${date}  ${s.messageCount} messages  ${s.model}  tokens: ${s.totalTokens}`,
      )
    }
  }
  process.exit(0)
}

let initialSession: Session | null = null

if (args.resume) {
  initialSession = loadSession(args.resume, sessionsDir)
  if (!initialSession) {
    console.error(`Session "${args.resume}" not found.`)
    process.exit(1)
  }
} else if (!args.new) {
  initialSession = loadLatestSession(projectPath)
}

const cliSystemPrompt = args.system
  ? existsSync(args.system)
    ? readFileSync(args.system, "utf-8")
    : args.system
  : undefined

const config = loadConfig({
  projectPath,
  cliArgs: {
    model: args.model,
    systemPrompt: cliSystemPrompt,
  },
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

const provider = createOpenRouterProvider({
  apiKey: config.apiKey,
  model,
})

const systemPrompt = assembleSystemPrompt({
  projectPath,
  projectPrompt: config.systemPrompt,
  cliPrompt: cliSystemPrompt && config.systemPrompt !== cliSystemPrompt ? cliSystemPrompt : undefined,
})

render(
  React.createElement(App, {
    provider,
    tools: readOnlyTools,
    systemPrompt,
    context: { projectPath },
    initialSession: initialSession ?? undefined,
    sessionsDir,
  }),
)
