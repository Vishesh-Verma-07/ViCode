import { describe, it, expect } from "bun:test"
import { CommandRegistry } from "./command-registry"
import type { Command } from "./types"

function makeCommand(name: string): Command {
  return {
    name,
    description: `Command ${name}`,
    execute: async () => `ran-${name}`,
  }
}

describe("CommandRegistry", () => {
  it("registers and retrieves a command", () => {
    const registry = new CommandRegistry()
    const command = makeCommand("help")
    registry.register(command)
    expect(registry.get("help")).toBe(command)
  })

  it("returns undefined for unknown command", () => {
    const registry = new CommandRegistry()
    expect(registry.get("unknown")).toBeUndefined()
  })

  it("registers multiple commands at once", () => {
    const registry = new CommandRegistry()
    registry.registerAll([makeCommand("a"), makeCommand("b")])
    expect(registry.has("a")).toBe(true)
    expect(registry.has("b")).toBe(true)
  })

  it("returns all commands", () => {
    const registry = new CommandRegistry()
    registry.registerAll([makeCommand("a"), makeCommand("b"), makeCommand("c")])
    expect(registry.getAll()).toHaveLength(3)
  })

  it("has returns correct boolean", () => {
    const registry = new CommandRegistry()
    expect(registry.has("x")).toBe(false)
    registry.register(makeCommand("x"))
    expect(registry.has("x")).toBe(true)
  })

  it("overwrites a command registered under the same name", () => {
    const registry = new CommandRegistry()
    const first = makeCommand("help")
    const second = makeCommand("help")
    registry.register(first)
    registry.register(second)
    expect(registry.get("help")).toBe(second)
    expect(registry.getAll()).toHaveLength(1)
  })
})
