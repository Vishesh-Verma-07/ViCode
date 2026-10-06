import { listProviders, providerEnvVars } from "../core/providers"
import { listSearchBackends } from "../core/search"
import { searchEnvVars } from "../core/search/credential"
import { SEARCH_CREDENTIAL_FIELD } from "./config"

export interface CliArgs {
  directory?: string
  help: boolean
}

export function parseArgs(args: string[]): CliArgs {
  const result: CliArgs = {
    help: false,
    directory: undefined,
  }

  let i = 0
  while (i < args.length) {
    const arg = args[i]

    if (arg === undefined) break

    if (arg === "--help" || arg === "-h") {
      result.help = true
    } else if (!arg.startsWith("-")) {
      result.directory = arg
    }

    i++
  }

  return result
}

/**
 * The environment-variable block, rendered from the Provider registry in the
 * order `keyForProvider` actually consults, so the documented precedence cannot
 * drift from the real one (ADR-0010).
 */
function formatEnvBlock(): string {
  const rows = listProviders()
    .map((provider) => providerEnvVars(provider.id))
    // Zen and Go sit on one console with one key, so their variables are the
    // same pair; printed once rather than twice in a row.
    .filter((names, index, all) => index === 0 || names.join() !== all[index - 1]?.join())
  const width = Math.max(...rows.map(([namespaced]) => namespaced?.length ?? 0))
  return rows
    .map(([namespaced, ...native]) => `       ${namespaced?.padEnd(width)}  then  ${native.join(", ")}`)
    .join("\n")
}

/**
 * The width both Provider tables align their id column on, so the two blocks
 * read as one list.
 */
const PROVIDER_ID_WIDTH =
  Math.max(...listProviders().map((provider) => provider.id.length)) + 2

/**
 * The Provider table, rendered from the registry so the help cannot list a
 * Provider ViCode does not serve, or miss one it does.
 */
function formatProviderBlock(): string {
  const providers = listProviders()
  const labelWidth = Math.max(...providers.map((provider) => provider.label.length)) + 2
  return providers
    .map(
      (provider) =>
        `    ${provider.id.padEnd(PROVIDER_ID_WIDTH)}${provider.label.padEnd(labelWidth)}${provider.billingNote ?? ""}`,
    )
    .join("\n")
}

/**
 * Where each Provider's key comes from, from the same registry the API Key
 * Entry Screen reads. The help used to name one Provider's URL under a table of
 * five, which left the other four with nowhere to look (issue #89).
 */
function formatKeyBlock(): string {
  return listProviders()
    .map((provider) => `    ${provider.id.padEnd(PROVIDER_ID_WIDTH)}${provider.keyUrl}`)
    .join("\n")
}

/**
 * The web search block, rendered from the search registry and from the same
 * `searchEnvVars` the Tool resolves with, so the documented order is the real one
 * (ADR-0010).
 *
 * A search credential is taught apart from an API Key on purpose. It is not a
 * Provider key, so it appears in none of the Provider blocks above: there is no
 * `/key` screen for it, no picker row, no Route Label and no cost. ViCode also
 * works without one, which is why the block calls it optional rather than
 * listing it as a step in getting started.
 */
function formatSearchBlock(): string {
  const backends = listSearchBackends()
  const vars = backends.map((backend) => {
    const [namespaced, native] = searchEnvVars(backend)
    return `       ${namespaced}  then  ${native}`
  })
  const sources = backends.map(
    (backend) => `       ${backend.label} — get a key at ${backend.keyUrl}`,
  )

  return [
    "",
    "  Web search (optional):",
    "  The web_search tool asks a search backend a question. It needs its own",
    "  credential, which is not a Provider key: it is never a route, so it does",
    "  not appear in the picker, the Route Label or cost. ViCode works without",
    "  one — a missing search credential is reported to the model that asked for",
    "  a search, not at startup.",
    `  1. ~/.vicode/config.json  → { "${SEARCH_CREDENTIAL_FIELD}": "your-key" }`,
    "  2. Environment variables, highest precedence first:",
    ...vars,
    ...sources,
  ].join("\n")
}

export function formatHelp(): string {
  return `Usage: vicode [directory]

An interactive terminal AI coding agent.

Arguments:
  directory               Project directory to operate in (default: current directory)

Options:
  -h, --help              Show this help information

Configuration:
  Config is loaded in priority order: project (.vicode.json) > global (~/.vicode/config.json).
  Runtime configuration (provider, model, skills, sessions, api keys) is available via slash commands:
  /model     - switch model, and with it the provider
  /provider  - switch provider
  /skill     - load skill markdown as System Prompt layer
  /new       - save current session and start fresh
  /session   - switch to a saved session
  /rename    - name the current session (or /rename clear)
  /key       - set or change an API key (interactive prompt)

  Providers:
${formatProviderBlock()}

  Models are named <provider>/<model>, e.g. anthropic/claude-opus-5-5.

  Set your API keys in one of:
  1. ~/.vicode/config.json  → { "apiKeys": { "openrouter": "your-key" } }
  2. Environment variables, highest precedence first:
${formatEnvBlock()}
     A VICODE_ name overrides the provider's own name for ViCode alone.
     OPENCODE_API_KEY authenticates both OpenCode Zen and OpenCode Go.
  3. Or type /key (or just start chatting) and you'll be prompted to enter your key

  Keys belong in the global config or the environment. A .vicode.json in your
  project is meant to be committed, so a key written there is refused.

  Get a key for the Provider you picked at:
${formatKeyBlock()}
${formatSearchBlock()}

Examples:
  vicode                          Start in current directory
  vicode ./my-project             Start in a specific directory`

}