import { describe, it, expect } from "bun:test"
import { createHelpCommand, formatCommandList } from "./help"
import { CommandRegistry } from "../core/command-registry"
import type { Command } from "../core/types"

describe("formatCommandList", () => {
  it("formats every command name and description", () => {
    const commands: Command[] = [
      { name: "help", description: "List available commands", execute: async () => "" },
      { name: "new", description: "Start a fresh session", execute: async () => "" },
    ]
    const text = formatCommandList(commands)
    expect(text).toContain("/help - List available commands")
    expect(text).toContain("/new - Start a fresh session")
  })

  it("returns one line per command", () => {
    const commands: Command[] = [
      { name: "a", description: "A", execute: async () => "" },
      { name: "b", description: "B", execute: async () => "" },
      { name: "c", description: "C", execute: async () => "" },
    ]
    const lines = formatCommandList(commands).split("\n")
    expect(lines).toHaveLength(3)
  })
})

describe("createHelpCommand", () => {
  it("is named help with a description", () => {
    const registry = new CommandRegistry()
    const help = createHelpCommand(registry)
    expect(help.name).toBe("help")
    expect(typeof help.description).toBe("string")
    expect(help.description.length).toBeGreaterThan(0)
  })

  it("prints all registered commands including itself", async () => {
    const registry = new CommandRegistry()
    registry.register({
      name: "new",
      description: "Start a fresh session",
      execute: async () => "",
    })
    registry.register(createHelpCommand(registry))

    const help = registry.get("help")!
    const output = await help.execute([], { projectPath: "/tmp/project" })

    expect(output).toContain("/help")
    expect(output).toContain("/new")
    expect(output).toContain("List available commands")
    expect(output).toContain("Start a fresh session")
  })
})
