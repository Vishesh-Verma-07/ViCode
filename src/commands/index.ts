import type { Command } from "../core/types"
import type { CommandRegistry } from "../core/command-registry"
import { createHelpCommand } from "./help"
import { createSessionCommand } from "./session"

export { createHelpCommand, formatCommandList } from "./help"
export { createSessionCommand, formatSessionMeta } from "./session"

export function createBuiltinCommands(registry: CommandRegistry): Command[] {
  return [createHelpCommand(registry), createSessionCommand()]
}
