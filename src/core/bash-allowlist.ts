import { isSensitivePath, resolveInsideProject } from "./sensitive-files"
import { normalizeCommand } from "./approval-grants"
import type { ToolContext } from "./types"

/**
 * The commands a fresh install runs without asking. Read-only by
 * construction: every entry either prints to stdout or lists the tree, and the
 * ones with a destructive mode are left out rather than trusted (`echo` can
 * redirect, `git branch -D` deletes). See ADR-0015.
 */
export const DEFAULT_SILENT_BASH_COMMANDS = [
  "ls",
  "pwd",
  "cat",
  "head",
  "tail",
  "wc",
  "rg",
  "grep",
  "find",
  "git status",
  "git diff",
  "git log",
  "git show",
]

/**
 * Verbs and flags that ask regardless of the Allowlist. Without them, prefix
 * matching would widen the old first-token hole: `find . -exec rm {} \;` leads
 * with an allowlisted token.
 */
const DESTRUCTIVE_VERBS = new Set([
  "rm",
  "rmdir",
  "dd",
  "mkfs",
  "mke2fs",
  "shutdown",
  "reboot",
  "halt",
  "poweroff",
  "kill",
  "pkill",
  "killall",
  "chmod",
  "chown",
  "chgrp",
  "sudo",
  "su",
  "doas",
  "-delete",
  "-exec",
  "-execdir",
  "-ok",
  "-okdir",
])

/** Two-or-more-token sequences that are destructive even though no single
 *  token is on the verb list. */
const DESTRUCTIVE_SEQUENCES = [
  ["git", "push"],
  ["git", "reset", "--hard"],
  ["git", "clean"],
  ["npm", "publish"],
  ["bun", "publish"],
  ["yarn", "publish"],
  ["pnpm", "publish"],
  ["cargo", "publish"],
]

/** Shell syntax the splitter cannot reason about safely, so the whole command
 *  asks rather than being parsed by guesswork. */
const UNPARSEABLE = /[`]|\$\(|<\(/

/** A redirection that writes to a file. `>&` alone is descriptor duplication
 *  (`2>&1`), which writes nothing, so it is not matched. */
const WRITES_VIA_REDIRECT = /&>|>(?!&)/

/** Programs whose job is to write, so they are not silent under an allowlisted
 *  reader's prefix (`cat a | tee b`). */
const WRITE_VERBS = new Set(["tee", "sponge"])

const CHAIN_SPLIT = /(?:;|&&|\|\||\||\r?\n)+/

function commandSegments(command: string): string[] | null {
  if (UNPARSEABLE.test(command)) return null
  const segments = command
    .split(CHAIN_SPLIT)
    .map((segment) => segment.trim())
    .filter(Boolean)
  return segments.length > 0 ? segments : []
}

function tokensOf(segment: string): string[] {
  return segment.split(/\s+/).filter(Boolean)
}

/** An entry matches when it is a leading token sequence of the segment. */
function matchesEntry(segment: string, entry: string): boolean {
  const segmentTokens = tokensOf(segment)
  const entryTokens = tokensOf(entry)
  if (entryTokens.length === 0 || entryTokens.length > segmentTokens.length) return false
  return entryTokens.every((token, index) => segmentTokens[index] === token)
}

function hasDestructiveSequence(tokens: string[]): boolean {
  return DESTRUCTIVE_SEQUENCES.some((sequence) =>
    sequence.every((token, index) => tokens[index] === token),
  )
}

function commandsWrite(segments: string[]): boolean {
  if (WRITES_VIA_REDIRECT.test(segments.join(" "))) return true
  return segments.some((segment) => tokensOf(segment).some((token) => WRITE_VERBS.has(token)))
}

/**
 * Whether the command contains a Destructive Verb. Tokens are matched as
 * whole words, so `rm.txt` is not `rm`; a false positive costs a prompt, a
 * false negative costs a filesystem.
 */
function containsDestructiveVerb(segments: string[]): boolean {
  for (const segment of segments) {
    const tokens = tokensOf(segment)
    if (tokens.some((token) => DESTRUCTIVE_VERBS.has(token))) return true

    // A destructive sequence can sit behind a wrapper that is itself part of
    // the segment, so scan every window rather than only the first tokens.
    for (let start = 0; start < tokens.length; start++) {
      if (hasDestructiveSequence(tokens.slice(start))) return true
    }
  }
  return false
}

/**
 * Resolves the configured list into the entries in force. Absent means the
 * shipped read-only defaults; an explicit empty list means ask everything;
 * anything else is the defaults plus the user's own entries.
 */
export function resolveAllowlist(configured: string[] | undefined): string[] {
  if (configured === undefined) return [...DEFAULT_SILENT_BASH_COMMANDS]
  if (configured.length === 0) return []
  return [...DEFAULT_SILENT_BASH_COMMANDS, ...configured]
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

/** Whether the resolved cwd stays inside the Project Root and off Sensitive
 *  Paths. */
function cwdIsSafe(declaredCwd: string, projectPath: string, patterns: string[]): boolean {
  const relCwd = resolveInsideProject(declaredCwd, projectPath)
  if (relCwd === null) return false
  return !isSensitiveDir(relCwd, patterns)
}

export function bashRequiresApproval(
  args: Record<string, unknown>,
  context: ToolContext,
): boolean {
  const command = typeof args.command === "string" ? args.command : ""
  if (command.trim().length === 0) return true

  const declaredCwd = typeof args.cwd === "string" ? args.cwd : ""
  const patterns = context.sensitivePatterns ?? []

  // The working directory is checked before any grant: a grant names a
  // command, not a location, so it cannot authorise a directory its user
  // never saw.
  if (!cwdIsSafe(declaredCwd, context.projectPath, patterns)) return true

  // A Command Grant is consent for this exact string, so it outranks the
  // Allowlist and the Destructive Verbs alike.
  if (context.approvalGrants?.has(normalizeCommand(command))) return false

  const allowlist = resolveAllowlist(context.silentBashCommands)
  if (allowlist.length === 0) return true

  const segments = commandSegments(command)
  if (segments === null || segments.length === 0) return true

  if (containsDestructiveVerb(segments)) return true
  if (commandsWrite(segments)) return true

  for (const segment of segments) {
    if (!allowlist.some((entry) => matchesEntry(segment, entry))) return true
  }

  for (const token of command.trim().split(/\s+/).filter(Boolean)) {
    for (const segment of tokenSegments(token)) {
      if (isSensitivePath(segment, patterns)) return true
    }
  }

  return false
}
