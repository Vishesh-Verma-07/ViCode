import type { Command } from "../core/types"
import type { CommandRegistry } from "../core/command-registry"

export function formatCommandList(commands: Command[]): string {
  return [
    ...commands.map((c) => `/${c.name} - ${c.description}`),
    "",
    "Tab shortcuts:",
    "Ctrl+T - Open a new Tab",
    "Ctrl+← / Ctrl+→ - Move between Tabs",
    "Ctrl+1 ... Ctrl+9 - Focus a Tab by number",
    "Ctrl+X - Close the active Tab (this does not delete its Session)",
    "Tab - Cycle the Mode (build -> discuss -> plan)",
  ].join("\n")
}

export function createHelpCommand(registry: CommandRegistry): Command {
  return {
    name: "help",
    description: "List available commands",
    execute: async () => formatCommandList(registry.getAll()),
  }
}
