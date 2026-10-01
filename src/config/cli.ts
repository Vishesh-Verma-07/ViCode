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
    openrouter    OpenRouter    pay per token
    openai        OpenAI        pay per token
    anthropic     Anthropic     pay per token
    opencode      OpenCode Zen  pay per token, prepaid balance
    opencode-go   OpenCode Go   subscription plan

  Models are named <provider>/<model>, e.g. anthropic/claude-opus-5-5.

  Set your API keys in one of:
  1. ~/.vicode/config.json  → { "apiKeys": { "openrouter": "your-key" } }
  2. .vicode.json in your project  → { "apiKeys": { "openrouter": "your-key" } }
  3. Environment variables:
       OPENROUTER_API_KEY   OPENAI_API_KEY
       ANTHROPIC_API_KEY    OPENCODE_API_KEY
     OPENCODE_API_KEY authenticates both OpenCode Zen and OpenCode Go.
  4. Or type /key (or just start chatting) and you'll be prompted to enter your key

  Get a key at https://openrouter.ai/keys

Examples:
  vicode                          Start in current directory
  vicode ./my-project             Start in a specific directory`

}