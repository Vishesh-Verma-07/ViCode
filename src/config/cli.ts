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
  Runtime configuration (model, skills, sessions) is available via slash commands:
  /model - switch LLM model mid-session
  /skill - load skill markdown as System Prompt layer
  /new   - save current session and start fresh
  /session - switch to a saved session

  Set your API key in one of:
  1. ~/.vicode/config.json  → { "apiKey": "your-key" }
  2. .vicode.json in your project  → { "apiKey": "your-key" }
  3. Environment variable  → OPENROUTER_API_KEY=your-key

  Get a key at https://openrouter.ai/keys

Examples:
  vicode                          Start in current directory
  vicode ./my-project             Start in a specific directory`

}