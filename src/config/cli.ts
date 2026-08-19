export interface CliArgs {
  directory?: string
  model?: string
  system?: string
  help: boolean
  new: boolean
  sessions: boolean
  resume?: string
}

export function parseArgs(args: string[]): CliArgs {
  const result: CliArgs = {
    help: false,
    new: false,
    sessions: false,
  }

  let i = 0
  while (i < args.length) {
    const arg = args[i]
    if (arg === undefined) break

    if (arg === "--help" || arg === "-h") {
      result.help = true
    } else if (arg === "--model" || arg === "-m") {
      result.model = args[++i]
    } else if (arg === "--system" || arg === "-s") {
      result.system = args[++i]
    } else if (arg === "--new") {
      result.new = true
    } else if (arg === "--sessions") {
      result.sessions = true
    } else if (arg === "--resume") {
      result.resume = args[++i]
    } else if (!arg.startsWith("-")) {
      result.directory = arg
    }

    i++
  }

  return result
}

export function formatHelp(): string {
  return `Usage: vicode [directory] [options]

An interactive terminal AI coding agent.

Arguments:
  directory               Project directory to operate in (default: current directory)

Options:
  -m, --model <model>     Override the configured model
  -s, --system <file>     Load a custom system prompt from a file
      --new               Start a fresh session (don't resume previous)
      --sessions          List past sessions for this directory
      --resume <id>       Resume a specific session by ID
  -h, --help              Show this help information

Examples:
  vicode                          Start in current directory
  vicode ./my-project             Start in a specific directory
  vicode --model openai/gpt-4o    Use a specific model
  vicode --sessions               List past sessions
  vicode --resume abc123          Resume a previous session
  vicode --new                    Start a fresh session

Configuration:
  Config is loaded in priority order: CLI flags > project (.vicode.json) > global (~/.vicode/config.json).
  Set your API key in config or via the OPENROUTER_API_KEY environment variable.
`
}
