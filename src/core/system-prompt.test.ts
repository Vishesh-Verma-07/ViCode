import { describe, it, expect, beforeEach, afterEach } from "bun:test"
import { assembleSystemPrompt } from "./system-prompt"
import { mkdirSync, writeFileSync, rmSync, existsSync } from "fs"
import { join } from "path"

const tmpDir = join(import.meta.dir, "__tmp_system_prompt_test")

beforeEach(() => {
  if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true })
  mkdirSync(tmpDir, { recursive: true })
})

afterEach(() => {
  if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true })
})

describe("assembleSystemPrompt", () => {
  it("returns base prompt when no project or CLI prompt", () => {
    const result = assembleSystemPrompt({ projectPath: tmpDir })
    expect(result).toContain("ViCode")
    expect(result.length).toBeGreaterThan(50)
  })

  it("includes base prompt with tool instructions", () => {
    const result = assembleSystemPrompt({ projectPath: tmpDir })
    expect(result).toContain("read_file")
    expect(result).toContain("write_file")
    expect(result).toContain("edit_file")
    expect(result).toContain("list_files")
    expect(result).toContain("bash")
    expect(result).toContain("search")
  })

  it("documents the permission behavior in the base prompt", () => {
    const result = assembleSystemPrompt({ projectPath: tmpDir })
    expect(result.toLowerCase()).toContain("without asking")
    expect(result.toLowerCase()).toContain("approval")
    expect(result.toLowerCase()).toContain("sensitive")
  })

  it("appends project prompt from .vicode/system.md", () => {
    mkdirSync(join(tmpDir, ".vicode"), { recursive: true })
    writeFileSync(join(tmpDir, ".vicode", "system.md"), "Project-specific rules here")
    const result = assembleSystemPrompt({ projectPath: tmpDir })
    expect(result).toContain("Project-specific rules here")
  })

  it("appends project prompt from config systemPrompt field", () => {
    const result = assembleSystemPrompt({
      projectPath: tmpDir,
      projectPrompt: "Config prompt text",
    })
    expect(result).toContain("Config prompt text")
  })

  it("project .vicode/system.md takes precedence over config systemPrompt", () => {
    mkdirSync(join(tmpDir, ".vicode"), { recursive: true })
    writeFileSync(join(tmpDir, ".vicode", "system.md"), "From file")
    const result = assembleSystemPrompt({
      projectPath: tmpDir,
      projectPrompt: "From config",
    })
    expect(result).toContain("From file")
    expect(result).not.toContain("From config")
  })

  it("appends CLI system prompt", () => {
    const result = assembleSystemPrompt({
      projectPath: tmpDir,
      cliPrompt: "CLI override prompt",
    })
    expect(result).toContain("CLI override prompt")
  })

  it("layers all three: base + project + CLI", () => {
    mkdirSync(join(tmpDir, ".vicode"), { recursive: true })
    writeFileSync(join(tmpDir, ".vicode", "system.md"), "Project layer")
    const result = assembleSystemPrompt({
      projectPath: tmpDir,
      cliPrompt: "CLI layer",
    })
    expect(result).toContain("ViCode")
    expect(result).toContain("Project layer")
    expect(result).toContain("CLI layer")
  })

  it("does not throw when .vicode/system.md does not exist", () => {
    const result = assembleSystemPrompt({ projectPath: tmpDir })
    expect(result).toBeDefined()
  })
})
