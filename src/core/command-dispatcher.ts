import type { CommandContext } from "./types"
import type { CommandRegistry } from "./command-registry"

export type CommandDispatchResult =
  | { kind: "pass-through" }
  | { kind: "executed"; output: string }
  | { kind: "failed"; error: string }
  | { kind: "unknown"; error: string }

export function isCommandAttempt(input: string): boolean {
  const firstWord = input.trim().split(/\s+/)[0] ?? ""
  return firstWord.startsWith("/")
}

function formatAvailableCommands(registry: CommandRegistry): string {
  return registry
    .getAll()
    .map((c) => `/${c.name}`)
    .join(", ")
}

export async function dispatchCommand(
  input: string,
  registry: CommandRegistry,
  context: CommandContext,
): Promise<CommandDispatchResult> {
  if (!isCommandAttempt(input)) {
    return { kind: "pass-through" }
  }

  const words = input.trim().split(/\s+/)
  const name = words[0]!.slice(1)
  const args = words.slice(1)

  const command = registry.get(name)
  if (!command) {
    return {
      kind: "unknown",
      error: `Unknown command: /${name}. Available commands: ${formatAvailableCommands(registry)}`,
    }
  }

  try {
    const output = await command.execute(args, context)
    return { kind: "executed", output }
  } catch (error) {
    return {
      kind: "failed",
      error: `Error executing /${name}: ${error instanceof Error ? error.message : String(error)}`,
    }
  }
}
