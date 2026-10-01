import type { Command } from "../core/types"
import type { CommandRegistry } from "../core/command-registry"
import { createHelpCommand } from "./help"
import { createSessionCommand } from "./session"
import { createRenameCommand } from "./rename"
import { createNewCommand } from "./new"
import { createExitCommand } from "./exit"
import { createModelCommand, createProviderCommand } from "./model"
import { createSkillCommand } from "./skill"
import { createHomeCommand } from "./home"
import { createKeyCommand } from "./key"
import { createCompactCommand } from "./compact"

export { createHelpCommand, formatCommandList } from "./help"
export { createSessionCommand, formatSessionName, formatSessionMeta } from "./session"
export { createRenameCommand } from "./rename"
export { createNewCommand } from "./new"
export { createExitCommand } from "./exit"
export { createModelCommand, createProviderCommand, formatModelPricing } from "./model"
export { createHomeCommand } from "./home"
export { createKeyCommand } from "./key"
export { createCompactCommand } from "./compact"

export function createBuiltinCommands(registry: CommandRegistry): Command[] {
  return [
    createHelpCommand(registry),
    createSessionCommand(),
    createRenameCommand(),
    createNewCommand(),
    createExitCommand(),
    createModelCommand(),
    createProviderCommand(),
    createSkillCommand(),
    createHomeCommand(),
    createKeyCommand(),
    createCompactCommand(),
  ]
}
