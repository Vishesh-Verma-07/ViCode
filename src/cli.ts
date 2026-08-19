#!/usr/bin/env bun

import { parseArgs, formatHelp } from "./config/cli"
import { loadConfig } from "./config/config"
import { resolve } from "path"

const args = parseArgs(process.argv.slice(2))

if (args.help) {
  console.log(formatHelp())
  process.exit(0)
}

const projectPath = args.directory ? resolve(args.directory) : process.cwd()

const config = loadConfig({
  projectPath,
  cliArgs: {
    model: args.model,
    systemPrompt: args.system,
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

console.log("ViCode Agent")
console.log("Project:", projectPath)
console.log("Model:", config.model ?? "(not configured)")
console.log("API Key: ***" + config.apiKey.slice(-4))
