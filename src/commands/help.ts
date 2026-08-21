import type { Command } from "../core/types"
import type { CommandRegistry } from "../core/command-registry"

export function formatCommandList(commands: Command[]): string {
  return commands.map((c) => `/${c.name} - ${c.description}`).join("\n")
}

export function createHelpCommand(registry: CommandRegistry): Command {
  return {
    name: "help",
    description: "List available commands",
    execute: async () => formatCommandList(registry.getAll()),
  }
}
