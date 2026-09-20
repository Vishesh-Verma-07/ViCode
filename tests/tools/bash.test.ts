import { describe, it, expect, beforeEach, afterEach } from "bun:test"
import { bashTool } from "@/tools/bash"
import { mkdirSync, rmSync, existsSync } from "fs"
import { join } from "path"
import type { ToolContext } from "@/core/types"

const tmpDir = join(import.meta.dir, "__tmp_bash_test")

beforeEach(() => {
  if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true })
  mkdirSync(tmpDir, { recursive: true })
})

afterEach(() => {
  if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true })
})

const ctx: ToolContext = { projectPath: tmpDir }

describe("bash tool", () => {
  it("has correct metadata", () => {
    expect(bashTool.name).toBe("bash")
    expect(bashTool.dangerous).toBe(true)
    expect(bashTool.description).toContain("shell")
  })

  it("runs a simple command", async () => {
    const result = await bashTool.execute({ command: "echo hello" }, ctx)
    expect(result).toContain("hello")
  })

  it("runs command in project directory by default", async () => {
    const result = await bashTool.execute({ command: "pwd" }, ctx)
    const dirName = tmpDir.split(/[\\/]/).pop()
    expect(result.trim()).toContain(dirName!)
  })

  it("runs command in custom cwd", async () => {
    const result = await bashTool.execute({ command: "pwd", cwd: "/tmp" }, ctx)
    expect(result).toContain("/tmp")
  })

  it("captures stderr", async () => {
    const result = await bashTool.execute({ command: "echo error >&2" }, ctx)
    expect(result).toContain("error")
  })

  it("returns error for failing command", async () => {
    const result = await bashTool.execute({ command: "false" }, ctx)
    expect(result).toContain("Error")
  })

  it("captures combined output", async () => {
    const result = await bashTool.execute({ command: "echo out && echo err >&2" }, ctx)
    expect(result).toContain("out")
    expect(result).toContain("err")
  })

  it("times out a long-running command", async () => {
    const result = await bashTool.execute({ command: "sleep 10", timeout: 1 }, ctx)
    expect(result).toContain("timed out")
    expect(result).toContain("1s")
  })

  it("returns no output message for commands with no output", async () => {
    const result = await bashTool.execute({ command: "true" }, ctx)
    expect(result).toBe("(no output)")
  })
})

describe("bash requiresApproval", () => {
  it("auto-approves commands run in the project root", async () => {
    const ctx: ToolContext = { projectPath: tmpDir }
    expect(await bashTool.requiresApproval?.({ command: "echo hello" }, ctx)).toBe(false)
    expect(await bashTool.requiresApproval?.({ command: "rm -rf ./" }, ctx)).toBe(false)
  })

  it("auto-approves commands in a nested project directory", async () => {
    const ctx: ToolContext = { projectPath: tmpDir }
    expect(await bashTool.requiresApproval?.({ command: "echo x > .env", cwd: "src" }, ctx)).toBe(false)
  })

  it("asks for commands that run outside the project root", async () => {
    const ctx: ToolContext = { projectPath: tmpDir }
    expect(await bashTool.requiresApproval?.({ command: "echo hello", cwd: "../" }, ctx)).toBe(true)
  })

  it("asks for an empty command", async () => {
    const ctx: ToolContext = { projectPath: tmpDir }
    expect(await bashTool.requiresApproval?.({ command: "" }, ctx)).toBe(true)
  })
})
