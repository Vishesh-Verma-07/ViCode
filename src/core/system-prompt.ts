import { readFileSync, existsSync } from "fs"
import { join } from "path"
import { MAX_TOOL_RESULT_BYTES } from "./cap-result"
import type { ToolDefinition } from "./types"
import { allTools } from "../tools"

const BASE_INTRO = `You are ViCode, an interactive terminal AI coding agent. You help developers write, understand, and modify code.`

const TOOL_PROMPT_ORDER = ["read_file", "write_file", "edit_file", "list_files", "search", "bash"]

const TOOL_PROMPT_DESCRIPTIONS: Record<string, string> = {
  read_file: "Read the contents of a file. Use this to understand existing code.",
  write_file: "Write content to a file (creates new or overwrites). Use for new files or full rewrites.",
  edit_file: "Apply targeted text replacements to a file. Use for precise changes to existing code.",
  list_files: "List directory contents or glob for files. Use to discover project structure.",
  search: "Search across files using regex/grep. Use to find relevant code quickly.",
  bash: "Execute shell commands. Use to run tests, build projects, install packages.",
}

const BASH_ALLOWLIST_BULLET = `A bash command runs as a **Silent Bash Call** — executing without pausing for user approval — only when ALL THREE of these hold: (1) its first token is on the Bash Allowlist (the \`silentBashCommands\` list in the global or project config), (2) none of its command tokens resolves to a Sensitive Path (like .env files, private keys, or \`.ssh\`), and (3) its resolved working directory stays inside the Project Root and is not a Sensitive Path. Any other bash command pauses for explicit user approval. Anyone can add commands to the allowlist, so never assume an allowlisted command is harmless just because it usually runs silently.`

const TRUNCATION_MARKERS_SECTION = `## Truncation Markers

Tool results are capped at ${MAX_TOOL_RESULT_BYTES} bytes and the model context is budgeted. When content is cut, the result carries a truncation marker — lines ringed by \`VICODE_TRUNCATION_SENTINEL\` naming how much was omitted. A marker means the text you see is not the full result; do not rely on it as exact text.

When you see a truncation marker, re-query narrowly before relying on the content — with a narrower search or a targeted command.`

const RESPONSE_FORMAT_SECTION = `## Response Format

- Be concise and direct.
- When making code changes, explain what you changed and why.
- If you're unsure about something, say so rather than guessing.`

function heldNames(tools: ToolDefinition[]): Set<string> {
  return new Set(tools.map((t) => t.name))
}

function availableToolsSection(tools: ToolDefinition[]): string {
  const ranked = [...tools].sort((a, b) => {
    const ia = TOOL_PROMPT_ORDER.indexOf(a.name)
    const ib = TOOL_PROMPT_ORDER.indexOf(b.name)
    return (ia === -1 ? Number.MAX_SAFE_INTEGER : ia) - (ib === -1 ? Number.MAX_SAFE_INTEGER : ib)
  })
  const lines = ranked.map((t) => `- **${t.name}** — ${TOOL_PROMPT_DESCRIPTIONS[t.name] ?? t.description}`)
  return `## Available Tools

You have access to the following tools:

${lines.join("\n")}`
}

function joinWith(items: string[], conjunction: "and" | "or"): string {
  if (items.length <= 1) return items[0] ?? ""
  if (items.length === 2) return `${items[0]} ${conjunction} ${items[1]}`
  const last = items[items.length - 1]
  return `${items.slice(0, -1).join(", ")}, ${conjunction} ${last}`
}

const PERMISSION_NOUNS: Record<string, string> = { read: "reads", write: "writes", edit: "edits" }
const PERMISSION_GERUNDS: Record<string, string> = { read: "reading", write: "writing", edit: "editing" }

function fileOperationKinds(held: Set<string>): Array<"read" | "write" | "edit"> {
  const kinds: Array<"read" | "write" | "edit"> = []
  if (held.has("read_file")) kinds.push("read")
  if (held.has("write_file")) kinds.push("write")
  if (held.has("edit_file")) kinds.push("edit")
  return kinds
}

function permissionsSection(held: Set<string>): string {
  const kinds = fileOperationKinds(held)
  const bullets: string[] = []

  if (kinds.length > 0) {
    const nouns = kinds.map((k) => PERMISSION_NOUNS[k]!)
    bullets.push(`File ${joinWith(nouns, "and")} within the Project Root on normal project files run immediately, without asking for confirmation.`)

    const gerunds = kinds.map((k) => PERMISSION_GERUNDS[k]!)
    gerunds[0] = gerunds[0]!.charAt(0).toUpperCase() + gerunds[0]!.slice(1)
    const coversWritesOrEdits = kinds.includes("write") || kinds.includes("edit")
    const readClause = coversWritesOrEdits && kinds.includes("read")
      ? " — reads pause for approval too, not just writes and edits."
      : "."
    bullets.push(`${joinWith(gerunds, "or")} Sensitive files (like .env files, private keys, and credential stores) pauses for explicit user approval${readClause}`)
    bullets.push(`${joinWith(gerunds, "or")} files outside the Project Root pauses for explicit user approval; the operation runs once approved.`)
  }

  if (held.has("bash")) bullets.push(BASH_ALLOWLIST_BULLET)

  return `## Permissions

${bullets.map((b) => `- ${b}`).join("\n")}`
}

function codeConventionsSection(held: Set<string>): string {
  const canModify = held.has("write_file") || held.has("edit_file")
  const hasWrite = held.has("write_file")
  const hasEdit = held.has("edit_file")
  const bullets: string[] = []

  if (canModify) bullets.push("Read files before modifying them to understand existing patterns.")
  bullets.push("Follow the code style already used in the project.")
  if (canModify) bullets.push("Make minimal, targeted changes — don't rewrite files unnecessarily.")
  if (hasEdit) bullets.push("When editing, preserve existing indentation and formatting.")
  if (hasEdit && hasWrite) bullets.push("Prefer edit_file over write_file for changes to existing files.")

  return `## Code Conventions

${bullets.map((b) => `- ${b}`).join("\n")}`
}

function safetySection(held: Set<string>): string {
  const canModify = held.has("write_file") || held.has("edit_file")
  const hasBash = held.has("bash")
  const bullets: string[] = []

  if (canModify) bullets.push("Always read a file before writing to it.")
  if (hasBash) bullets.push("When using bash, prefer read-only commands first (ls, cat, grep) before destructive ones.")
  if (hasBash) bullets.push("Be careful with rm, git push, and other irreversible commands.")
  bullets.push("Explain what you're about to do before doing it.")

  return `## Safety

${bullets.map((b) => `- ${b}`).join("\n")}`
}

function baseSystemPrompt(tools: ToolDefinition[]): string {
  const held = heldNames(tools)
  const parts: string[] = [
    BASE_INTRO,
    availableToolsSection(tools),
    codeConventionsSection(held),
    permissionsSection(held),
    safetySection(held),
    TRUNCATION_MARKERS_SECTION,
  ]
  if (held.has("edit_file")) {
    parts.push(
      "Before edit_file, if the region you intend to change was covered by a marked read, re-read the file fully first so your oldText matches the on-disk bytes exactly — edit_file only replaces a verbatim substring.",
    )
  }
  parts.push(RESPONSE_FORMAT_SECTION)
  return parts.join("\n\n")
}

interface AssemblePromptOptions {
  projectPath: string
  projectPrompt?: string
  cliPrompt?: string
  skillPrompts?: string[]
  tools?: ToolDefinition[]
}

function readPromptFile(path: string): string | null {
  if (!existsSync(path)) return null
  try {
    return readFileSync(path, "utf-8").trim()
  } catch {
    return null
  }
}

export function assembleSystemPrompt(options: AssemblePromptOptions): string {
  const { projectPath, projectPrompt: cliProjectPrompt, cliPrompt, skillPrompts, tools = allTools } = options

  const parts: string[] = [baseSystemPrompt(tools)]

  const projectFilePrompt = readPromptFile(join(projectPath, ".vicode", "system.md"))
  const projectPrompt = projectFilePrompt ?? cliProjectPrompt

  if (projectPrompt) {
    parts.push(projectPrompt)
  }

  if (cliPrompt) {
    parts.push(cliPrompt)
  }

  if (skillPrompts && skillPrompts.length > 0) {
    parts.push(...skillPrompts)
  }

  return parts.join("\n\n")
}