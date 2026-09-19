import { isSensitivePath, resolveInsideProject } from "./sensitive-files"
import type { ToolContext } from "./types"

function firstCommandToken(command: string): string | null {
  const trimmed = command.trim()
  if (!trimmed) return null
  return trimmed.split(/\s+/)[0] ?? null
}

function commandTokens(command: string): string[] {
  return command.trim().split(/\s+/).filter(Boolean)
}

function tokenSegments(token: string): string[] {
  return token
    .split(/[<>;&|()]+/)
    .map((segment) => segment.replace(/^['"]|['"]$/g, "").trim())
    .filter(Boolean)
}

const DIR_PROBE = "__vicode_probe"

function isSensitiveDir(relDir: string, patterns: string[]): boolean {
  const normalized = relDir.replace(/\\/g, "/")
  if (!normalized || normalized === ".") return false
  if (isSensitivePath(normalized, patterns)) return true
  return isSensitivePath(`${normalized}/${DIR_PROBE}`, patterns)
}

export function bashRequiresApproval(
  args: Record<string, unknown>,
  context: ToolContext,
): boolean {
  const command = typeof args.command === "string" ? args.command : ""
  const allowlist = context.silentBashCommands ?? []
  const patterns = context.sensitivePatterns ?? []

  if (allowlist.length === 0) return true

  const firstToken = firstCommandToken(command)
  if (firstToken === null) return true
  if (!allowlist.includes(firstToken)) return true

  for (const token of commandTokens(command)) {
    for (const segment of tokenSegments(token)) {
      if (isSensitivePath(segment, patterns)) return true
    }
  }

  const declaredCwd = typeof args.cwd === "string" ? args.cwd : ""
  const relCwd = resolveInsideProject(declaredCwd, context.projectPath)
  if (relCwd === null) return true

  return isSensitiveDir(relCwd, patterns)
}