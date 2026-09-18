import type { Command } from "../core/types"
import type { CommandRegistry } from "../core/command-registry"
import { createHelpCommand } from "./help"
import { createSessionCommand } from "./session"
import { createNewCommand } from "./new"
import { createExitCommand } from "./exit"
import { createModelCommand } from "./model"
import { createSkillCommand } from "./skill"
import { createHomeCommand } from "./home"
import { createKeyCommand } from "./key"

export { createHelpCommand, formatCommandList } from "./help"
export { createSessionCommand, formatSessionMeta } from "./session"
export { createNewCommand } from "./new"
export { createExitCommand } from "./exit"
export { createModelCommand, formatModelPricing } from "./model"
export { createHomeCommand } from "./home"
export { createKeyCommand } from "./key"

export function createBuiltinCommands(registry: CommandRegistry): Command[] {
  return [
    createHelpCommand(registry),
    createSessionCommand(),
    createNewCommand(),
    createExitCommand(),
    createModelCommand(),
    createSkillCommand(),
    createHomeCommand(),
    createKeyCommand(),
  ]
}
