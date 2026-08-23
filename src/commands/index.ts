import type { Command } from "../core/types"
import type { CommandRegistry } from "../core/command-registry"
import { createHelpCommand } from "./help"
import { createSessionCommand } from "./session"
import { createNewCommand } from "./new"
import { createExitCommand } from "./exit"
import { createModelCommand } from "./model"
import { createSkillCommand } from "./skill"

export { createHelpCommand, formatCommandList } from "./help"
export { createSessionCommand, formatSessionMeta } from "./session"
export { createNewCommand } from "./new"
export { createExitCommand } from "./exit"
export { createModelCommand, formatModelPricing } from "./model"

export function createBuiltinCommands(registry: CommandRegistry): Command[] {
  return [
    createHelpCommand(registry),
    createSessionCommand(),
    createNewCommand(),
    createExitCommand(),
    createModelCommand(),
    createSkillCommand(),
  ]
}
