import { describe, it, expect, beforeEach, afterEach } from "bun:test"
import { assembleSystemPrompt } from "@/core/system-prompt"
import { mkdirSync, writeFileSync, rmSync, existsSync } from "fs"
import { join } from "path"
import { VICODE_TRUNCATION_SENTINEL, MAX_TOOL_RESULT_BYTES } from "@/core/cap-result"
import { allTools, readOnlyTools } from "@/tools"
import { writeFileTool } from "@/tools/write-file"
import { editFileTool } from "@/tools/edit-file"
import type { ToolDefinition } from "@/core/types"

const TRUNCATION_MARKER_NAME = VICODE_TRUNCATION_SENTINEL.replace(/\u0000/g, "")

function sectionOf(prompt: string, heading: string): string {
  const marker = `## ${heading}`
  const start = prompt.indexOf(marker)
  if (start === -1) return ""
  const body = prompt.slice(start + marker.length)
  const next = body.search(/\n## /)
  return next === -1 ? body : body.slice(0, next)
}

const readWriteEditTools: ToolDefinition[] = [...readOnlyTools, writeFileTool, editFileTool]

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

const FULL_SET_EXPECTED = `You are ViCode, an interactive terminal AI coding agent. You help developers write, understand, and modify code.

## Available Tools

You have access to the following tools:

- **read_file** — Read the contents of a file. Use this to understand existing code.
- **write_file** — Write content to a file (creates new or overwrites). Use for new files or full rewrites.
- **edit_file** — Apply targeted text replacements to a file. Use for precise changes to existing code.
- **list_files** — List directory contents or glob for files. Use to discover project structure.
- **search** — Search across files using regex/grep. Use to find relevant code quickly.
- **bash** — Execute shell commands. Use to run tests, build projects, install packages.

## Code Conventions

- Read files before modifying them to understand existing patterns.
- Follow the code style already used in the project.
- Make minimal, targeted changes — don't rewrite files unnecessarily.
- When editing, preserve existing indentation and formatting.
- Prefer edit_file over write_file for changes to existing files.

## Permissions

- File reads, writes, and edits within the Project Root on normal project files run immediately, without asking for confirmation.
- Reading, writing, or editing Sensitive files (like .env files, private keys, and credential stores) pauses for explicit user approval — reads pause for approval too, not just writes and edits.
- Reading, writing, or editing files outside the Project Root pauses for explicit user approval; the operation runs once approved.
- A bash command runs as a **Silent Bash Call** — executing without pausing for user approval — only when ALL THREE of these hold: (1) its first token is on the Bash Allowlist (the \`silentBashCommands\` list in the global or project config), (2) none of its command tokens resolves to a Sensitive Path (like .env files, private keys, or \`.ssh\`), and (3) its resolved working directory stays inside the Project Root and is not a Sensitive Path. Any other bash command pauses for explicit user approval. Anyone can add commands to the allowlist, so never assume an allowlisted command is harmless just because it usually runs silently.

## Safety

- Always read a file before writing to it.
- When using bash, prefer read-only commands first (ls, cat, grep) before destructive ones.
- Be careful with rm, git push, and other irreversible commands.
- Explain what you're about to do before doing it.

## Truncation Markers

Tool results are capped at ${MAX_TOOL_RESULT_BYTES} bytes and the model context is budgeted. When content is cut, the result carries a truncation marker — lines ringed by \`VICODE_TRUNCATION_SENTINEL\` naming how much was omitted. A marker means the text you see is not the full result; do not rely on it as exact text.

When you see a truncation marker, re-query narrowly before relying on the content — with a narrower search or a targeted command.

Before edit_file, if the region you intend to change was covered by a marked read, re-read the file fully first so your oldText matches the on-disk bytes exactly — edit_file only replaces a verbatim substring.

## Response Format

- Be concise and direct.
- When making code changes, explain what you changed and why.
- If you're unsure about something, say so rather than guessing.`

describe("assembleSystemPrompt (tool-array-driven)", () => {
  it("assembling for the full tool set reproduces today's base prompt bit-for-bit", () => {
    const result = assembleSystemPrompt({ projectPath: tmpDir, tools: allTools })
    expect(result).toBe(FULL_SET_EXPECTED)
  })

  it("assembling for the full tool set (via default) keeps every tool described", () => {
    const result = assembleSystemPrompt({ projectPath: tmpDir })
    for (const name of ["read_file", "write_file", "edit_file", "list_files", "search", "bash"]) {
      expect(result).toContain(`**${name}**`)
    }
  })

  it("read-only tool set lists only the read-only trio and never mentions write/edit/bash", () => {
    const result = assembleSystemPrompt({ projectPath: tmpDir, tools: readOnlyTools })
    const toolsSection = sectionOf(result, "Available Tools")
    const toolLines = toolsSection.split("\n").filter((l) => l.startsWith("- **"))
    expect(toolLines).toEqual([
      "- **read_file** — Read the contents of a file. Use this to understand existing code.",
      "- **list_files** — List directory contents or glob for files. Use to discover project structure.",
      "- **search** — Search across files using regex/grep. Use to find relevant code quickly.",
    ])
    expect(result).not.toContain("bash")
    expect(result).not.toContain("write_file")
    expect(result).not.toContain("edit_file")
    expect(sectionOf(result, "Permissions")).not.toContain("write_file")
    expect(sectionOf(result, "Permissions")).not.toContain("edit_file")
    expect(sectionOf(result, "Permissions")).not.toContain("bash")
  })

  it("read-only permissions describe reads only", () => {
    const result = assembleSystemPrompt({ projectPath: tmpDir, tools: readOnlyTools })
    const permissions = sectionOf(result, "Permissions")
    expect(permissions).toContain("File reads within the Project Root on normal project files run immediately")
    expect(permissions).not.toContain("writes, and edits")
    expect(permissions).toContain("Reading Sensitive files (like .env files, private keys, and credential stores) pauses for explicit user approval.")
    expect(permissions).not.toContain("Silent Bash Call")
    expect(permissions).not.toContain("Bash Allowlist")
  })

  it("read-only conventions and safety avoid absent tool families", () => {
    const result = assembleSystemPrompt({ projectPath: tmpDir, tools: readOnlyTools })
    expect(sectionOf(result, "Code Conventions")).not.toContain("edit_file")
    expect(sectionOf(result, "Code Conventions")).not.toContain("write_file")
    expect(sectionOf(result, "Safety")).not.toContain("writing")
    expect(sectionOf(result, "Safety")).not.toContain("bash")
  })

  it("read-only + write/edit set (no bash) still describes write/edit but never mentions bash", () => {
    const result = assembleSystemPrompt({ projectPath: tmpDir, tools: readWriteEditTools })
    const toolsSection = sectionOf(result, "Available Tools")
    expect(toolsSection).toContain("write_file")
    expect(toolsSection).toContain("edit_file")
    expect(toolsSection).not.toContain("bash")
    const permissions = sectionOf(result, "Permissions")
    expect(permissions).toContain("File reads, writes, and edits within the Project Root")
    expect(permissions).not.toContain("bash")
    expect(permissions).not.toContain("Silent Bash Call")
    expect(permissions).not.toContain("Bash Allowlist")
    expect(result).not.toContain("bash")
  })

  it("a write/edit set that lacks read_file does not claim reads exist", () => {
    const result = assembleSystemPrompt({ projectPath: tmpDir, tools: [writeFileTool, editFileTool] })
    const permissions = sectionOf(result, "Permissions")
    expect(permissions).toContain("Writing or editing Sensitive files (like .env files, private keys, and credential stores) pauses for explicit user approval.")
    expect(permissions).not.toContain("reads pause for approval too")
  })

  it("static project/CLI/skill layers still aggregate identically for any tool set", () => {
    mkdirSync(join(tmpDir, ".vicode"), { recursive: true })
    writeFileSync(join(tmpDir, ".vicode", "system.md"), "Project layer")
    const options = {
      projectPath: tmpDir,
      cliPrompt: "CLI layer",
      skillPrompts: ["SkillA", "SkillB"],
    }
    const full = assembleSystemPrompt({ ...options, tools: allTools })
    const readOnly = assembleSystemPrompt({ ...options, tools: readOnlyTools })
    const suffix = "\n\nProject layer\n\nCLI layer\n\nSkillA\n\nSkillB"
    expect(full.endsWith(suffix)).toBe(true)
    expect(readOnly.endsWith(suffix)).toBe(true)
    expect(readOnly).not.toBe(full)
  })
})
