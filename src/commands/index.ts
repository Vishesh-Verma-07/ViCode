import type { Command } from "../core/types"
import type { CommandRegistry } from "../core/command-registry"
import { createHelpCommand } from "./help"
import { createSessionCommand } from "./session"
import { createNewCommand } from "./new"
import { createExitCommand } from "./exit"

export { createHelpCommand, formatCommandList } from "./help"
export { createSessionCommand, formatSessionMeta } from "./session"
export { createNewCommand } from "./new"
export { createExitCommand } from "./exit"

export function createBuiltinCommands(registry: CommandRegistry): Command[] {
  return [createHelpCommand(registry), createSessionCommand(), createNewCommand(), createExitCommand()]
}
