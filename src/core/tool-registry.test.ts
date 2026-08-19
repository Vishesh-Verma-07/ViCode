import { describe, it, expect } from "bun:test"
import { ToolRegistry } from "./tool-registry"
import type { ToolDefinition } from "./types"
import { z } from "zod"

function makeTool(name: string, dangerous = false): ToolDefinition {
  return {
    name,
    description: `Tool ${name}`,
    parameters: z.object({}),
    execute: async () => `result-${name}`,
    dangerous,
  }
}

describe("ToolRegistry", () => {
  it("registers and retrieves a tool", () => {
    const registry = new ToolRegistry()
    const tool = makeTool("read_file")
    registry.register(tool)
    expect(registry.get("read_file")).toBe(tool)
  })

  it("returns undefined for unknown tool", () => {
    const registry = new ToolRegistry()
    expect(registry.get("unknown")).toBeUndefined()
  })

  it("registers multiple tools at once", () => {
    const registry = new ToolRegistry()
    registry.registerAll([makeTool("a"), makeTool("b")])
    expect(registry.has("a")).toBe(true)
    expect(registry.has("b")).toBe(true)
  })

  it("returns all tools", () => {
    const registry = new ToolRegistry()
    registry.registerAll([makeTool("a"), makeTool("b"), makeTool("c")])
    expect(registry.getAll()).toHaveLength(3)
  })

  it("filters dangerous tools", () => {
    const registry = new ToolRegistry()
    registry.registerAll([
      makeTool("safe", false),
      makeTool("dangerous", true),
      makeTool("also-safe", false),
    ])
    expect(registry.getDangerousTools()).toHaveLength(1)
    expect(registry.getDangerousTools()[0]!.name).toBe("dangerous")
  })

  it("has returns correct boolean", () => {
    const registry = new ToolRegistry()
    expect(registry.has("x")).toBe(false)
    registry.register(makeTool("x"))
    expect(registry.has("x")).toBe(true)
  })
})
