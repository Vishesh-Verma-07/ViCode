import type { Command } from "../core/types"
import type { CommandRegistry } from "../core/command-registry"
import { createHelpCommand } from "./help"

export { createHelpCommand, formatCommandList } from "./help"

export function createBuiltinCommands(registry: CommandRegistry): Command[] {
  return [createHelpCommand(registry)]
}
