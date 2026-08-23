import type { Command } from "./types"

export class CommandRegistry {
  private commands = new Map<string, Command>()

  register(command: Command): void {
    this.commands.set(command.name, command)
  }

  registerAll(commands: Command[]): void {
    for (const command of commands) {
      this.register(command)
    }
  }

  get(name: string): Command | undefined {
    return this.commands.get(name)
  }

  getAll(): Command[] {
    return Array.from(this.commands.values())
  }

  has(name: string): boolean {
    return this.commands.has(name)
  }
}
