import React from "react"
import { render } from "ink"
import { parseArgs, formatHelp } from "./config/cli"
import {
  loadConfig,
  keyForProvider,
  saveApiKeyToGlobalConfig,
  removeApiKeyFromGlobalConfig,
  ConfigError,
  type AppConfig,
} from "./config/config"
import { resolve } from "path"
import { readFileSync, existsSync } from "fs"
import { createProvider } from "./providers"
import { loadCatalogOffline } from "./core/catalog"
import { formatModelId, parseModelId, resolveModelId, LEGACY_PROVIDER } from "./core/model-id"
import { allTools } from "./tools"
import { CommandRegistry } from "./core/command-registry"
import { createBuiltinCommands } from "./commands"
import { App } from "./ui/app"
import { createBackspaceRewritingStdin } from "./ui/backspace-encoding"
import {
  getSessionsDir,
  loadLatestSession,
} from "./core/session"
import { log } from "./utils/logger"

/**
 * The route a fresh install starts on: OpenRouter's free model, qualified so it
 * is no longer an OpenRouter-only assumption (ADR-0006).
 */
const DEFAULT_MODEL = formatModelId(LEGACY_PROVIDER, "nvidia/nemotron-3-ultra-550b-a55b:free")

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

const initialSession = loadLatestSession(projectPath)

/**
 * Reports a config the loader refused and stops.
 *
 * Naming the field is the useful answer: the user learns which one to move, and
 * a strict schema that refused it has told them nothing yet. The advice is
 * specific to the file and the field, because a typo in a global config is a
 * different problem from a key in a project one, and naming keys for the first
 * would send them looking in the wrong file (issue #87).
 */
function loadConfigOrExit(rootPath: string): AppConfig {
  try {
    return loadConfig({ projectPath: rootPath })
  } catch (error) {
    console.error("\nCould not read the config:\n")
    console.error(error instanceof Error ? error.message : String(error))
    if (error instanceof ConfigError && error.refusesApiKey) {
      console.error(
        "\nAn API key belongs in ~/.vicode/config.json, or in VICODE_<PROVIDER>_API_KEY in the\nenvironment — a project .vicode.json is meant to be committed, so a key there is a\nleaked one. Remove it from that file and put it in either of those.",
      )
    }
    console.error("")
    process.exit(1)
  }
}

const config = loadConfigOrExit(projectPath)

/**
 * A resumed session's model wins over config: the conversation is on it. Both
 * are already canonical after their own upgrade, so this only guards a
 * hand-edited value that cannot be parsed.
 */
const model = initialSession?.model || config.model || DEFAULT_MODEL
const parsedModel = parseModelId(model)
const resolvedModel = parsedModel.provider ? parsedModel : resolveModelId(model)
const activeProvider = resolvedModel.provider
log("component mounted ", model)

// Boot on whatever catalog is already cached so the TUI renders immediately;
// refresh in the background so pricing and context limits are current.
loadCatalogOffline()
void import("./core/catalog").then(({ ensureCatalog }) => {
  ensureCatalog().catch(() => {
    // Offline on first run: models, prices, and context limits stay unknown
    // rather than blocking the session (ADR-0005).
  })
})

const keyFor = (provider: typeof activeProvider) => keyForProvider(config, provider) ?? ""
const apiKey = keyFor(activeProvider)

const provider = createProvider({ model: formatModelId(activeProvider, resolvedModel.model), apiKey })

const commandRegistry = new CommandRegistry()
commandRegistry.registerAll(createBuiltinCommands(commandRegistry))

render(
  React.createElement(App, {
    provider,
    createProvider: (canonicalModelId: string, key: string) =>
      createProvider({ model: canonicalModelId, apiKey: key }),
    tools: allTools,
    projectPrompt: config.systemPrompt,
    context: {
      projectPath,
      sensitivePatterns: config.sensitiveFiles,
      silentBashCommands: config.silentBashCommands,
    },
    initialSession: initialSession ?? undefined,
    sessionsDir,
    commands: commandRegistry.getAll(),
    keyFor: (providerId) => keyForProvider(config, providerId),
    onSaveApiKey: (providerId, key) => {
      config.apiKeys[providerId] = key
      saveApiKeyToGlobalConfig(providerId, key)
    },
    onRemoveApiKey: (providerId) => {
      delete config.apiKeys[providerId]
      removeApiKeyFromGlobalConfig(providerId)
    },
  }),
  { stdin: createBackspaceRewritingStdin(process.stdin) },
)