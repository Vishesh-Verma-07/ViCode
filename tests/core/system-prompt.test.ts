import { describe, it, expect, beforeEach, afterEach } from "bun:test"
import { assembleSystemPrompt } from "@/core/system-prompt"
import { mkdirSync, writeFileSync, rmSync, existsSync } from "fs"
import { join } from "path"
import { VICODE_TRUNCATION_SENTINEL } from "@/core/cap-result"

const TRUNCATION_MARKER_NAME = VICODE_TRUNCATION_SENTINEL.replace(/\u0000/g, "")

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
    const lower = result.toLowerCase()
    expect(lower).toContain("without asking")
    expect(lower).toContain("approval")
    expect(lower).toContain("sensitive")
    expect(lower).toContain("outside the project root")
    expect(lower).toContain("reads")
    expect(lower).toContain("pauses for explicit user approval")
  })

  it("documents the Bash Allowlist rule in the base prompt", () => {
    const result = assembleSystemPrompt({ projectPath: tmpDir })
    const lower = result.toLowerCase()
    expect(lower).toContain("bash allowlist")
    expect(lower).toContain("silentbashcommands")
    expect(lower).toContain("first token")
    expect(lower).toContain("silent bash call")
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

  it("explains that a truncation marker means content was cut and states the re-query response", () => {
    const result = assembleSystemPrompt({ projectPath: tmpDir })
    const section = result.toLowerCase().slice(result.toLowerCase().indexOf("truncation markers"))
    expect(result).toContain(TRUNCATION_MARKER_NAME)
    expect(section).toContain("truncation marker")
    expect(section).toMatch(/cut|omitted/)
    expect(section).toMatch(/re-?quer/)
    expect(section).toContain("narrow")
  })

  it("guides the model to re-read exactly before edit_file when relevant content was marked", () => {
    const result = assembleSystemPrompt({ projectPath: tmpDir })
    const section = result.toLowerCase().slice(result.toLowerCase().indexOf("truncation markers"))
    expect(section).toContain("edit_file")
    expect(section).toMatch(/re-?read/)
    expect(section).toMatch(/mark/)
    expect(section).toMatch(/oldtext/)
  })
})
