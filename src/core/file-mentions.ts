/**
 * File Mentions: `@path` in the Input Box draft that attaches a project file
 * to the user's message, so the model reads it without spending a Tool Call.
 *
 * The draft half (detecting the mention under the cursor, ranking files for
 * the suggestion dropdown) is pure; the send half (reading each named file
 * into a File Attachment) touches the filesystem and goes through the
 * Approval Rule for anything the read-file Tool would have asked about.
 * ADR-0014 holds the reasoning for that last part.
 */
import { readFileSync, statSync } from "fs"
import { resolve, relative } from "path"
import { capResult } from "./cap-result"
import { collectProjectFiles } from "./project-files"
import { isSensitivePath, pathRequiresApproval } from "./sensitive-files"
import type { ToolContext } from "./types"

/** Bytes one File Attachment may carry; longer files are capped head+tail. */
export const MAX_ATTACHMENT_BYTES = 64 * 1024

/** Files the File Suggestion dropdown offers at most. */
export const MENTION_SUGGESTION_LIMIT = 8

const INDEX_TTL_MS = 10_000

export interface MentionQuery {
  /** Index of the `@` that opens the mention. */
  start: number
  /** The path fragment typed after the `@` so far. */
  fragment: string
}

/**
 * The mention the Cursor sits in, if any: an `@` that starts a word, with no
 * whitespace between it and the Cursor. A completed mention followed by more
 * words is not active — the Cursor has left it — and `@` inside a word
 * (an email address, a decorator) never opens one.
 */
export function detectMention(text: string, cursor: number): MentionQuery | null {
  const c = Math.max(0, Math.min(cursor, text.length))
  const head = text.slice(0, c)
  const match = /(?:^|\s)@([^\s@]*)$/.exec(head)
  if (!match) return null
  const fragment = match[1]!
  return { start: c - fragment.length - 1, fragment }
}

export interface MentionToken {
  /** Index of the `@`. */
  start: number
  /** Index just past the path token. */
  end: number
  /** The path as typed. */
  path: string
}

/**
 * Every word-start `@path` token in a submitted input, in order. Same rule as
 * `detectMention`, applied to the whole draft rather than to the Cursor: a
 * mention the picker completed and a path typed by hand are both read.
 */
export function extractMentions(text: string): MentionToken[] {
  const tokens: MentionToken[] = []
  const re = /(?:^|\s)@([^\s@]+)/g
  let match: RegExpExecArray | null
  while ((match = re.exec(text)) !== null) {
    const path = match[1]!
    tokens.push({
      start: match.index + match[0].length - path.length - 1,
      end: match.index + match[0].length,
      path,
    })
  }
  return tokens
}

const indexCache = new Map<string, { files: string[]; at: number }>()

/** Forgets the cached index so a test — or a fresh walk — starts clean. */
export function clearMentionFileIndex(): void {
  indexCache.clear()
}

/**
 * The files the File Suggestion dropdown offers: every project text file as a
 * Project-Root-relative path, minus Sensitive Paths — an autocomplete is a
 * list of what is easy to grab, and a Sensitive Path is never easy to grab.
 *
 * Cached for a short window, because the dropdown asks on every keystroke and
 * re-walking the tree per character is not a thing a keystroke should cost.
 */
export function listMentionableFiles(projectPath: string, now: number = Date.now()): string[] {
  const hit = indexCache.get(projectPath)
  if (hit && now - hit.at < INDEX_TTL_MS) return hit.files
  let files: string[]
  try {
    files = collectProjectFiles(projectPath)
      .map((abs) => relative(projectPath, abs).replace(/\\/g, "/"))
      .filter((rel) => !isSensitivePath(rel))
  } catch {
    // No tree to offer from. An empty list keeps the dropdown honest — it
    // says nothing matches rather than crashing the keystroke that asked.
    files = []
  }
  indexCache.set(projectPath, { files, at: now })
  return files
}

/**
 * How well a path answers a fragment, or null when it does not.
 *
 * A subsequence score with two bonuses — a character landing at the start of
 * the path or right after a separator, and a character consecutive with the
 * last match — so `app` ranks `src/app.ts` (three anchored hits) above
 * `a-package.tsx` (three scattered ones), and a prefix beats a wisp.
 */
function mentionScore(path: string, query: string): number | null {
  let score = 0
  let qi = 0
  let lastMatch = -2
  for (let i = 0; i < path.length && qi < query.length; i++) {
    if (path[i] !== query[qi]) continue
    let bonus = 1
    if (i === 0) bonus = 12
    else if ("/-_.".includes(path[i - 1]!)) bonus = 8
    if (i === lastMatch + 1) bonus += 4
    score += bonus
    lastMatch = i
    qi++
  }
  return qi === query.length ? score : null
}

/**
 * The files worth showing for a typed fragment, best first. An empty fragment
 * lists the project shallow-and-short rather than in walk order, so the first
 * screen of an empty `@` is the files a user most likely means.
 */
export function filterMentionFiles(
  files: string[],
  fragment: string,
  limit: number = MENTION_SUGGESTION_LIMIT,
): string[] {
  if (!fragment) {
    return [...files]
      .sort((a, b) => a.split("/").length - b.split("/").length || a.length - b.length || a.localeCompare(b))
      .slice(0, limit)
  }
  const query = fragment.toLowerCase()
  const scored: Array<{ file: string; score: number }> = []
  for (const file of files) {
    const score = mentionScore(file.toLowerCase(), query)
    if (score !== null) scored.push({ file, score })
  }
  scored.sort((a, b) => b.score - a.score || a.file.length - b.file.length || a.file.localeCompare(b.file))
  return scored.slice(0, limit).map((s) => s.file)
}

export interface MentionAttachment {
  /** Path relative to the Project Root, forward slashes. */
  path: string
  /** The file's content, capped. */
  content: string
}

export interface MentionExpansion {
  attachments: MentionAttachment[]
  /** One line per mention that was not attached, saying why. */
  notes: string[]
}

export interface ExpandMentionOptions {
  /**
   * Asks whether reading `declaredPath` may go ahead, for the reads the
   * Approval Rule stops — a Sensitive Path or one outside the Project Root.
   * Absent, those reads are refused rather than performed unasked.
   */
  requestApproval?: (declaredPath: string) => Promise<boolean>
}

function errorDetail(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * Reads every `@path` token in a submitted input into a File Attachment.
 *
 * A mention is a read of a named path, so it owes the same consent a
 * `read_file` of that path would: sensitive and outside-the-project targets
 * pause for approval, and a declined or unaskable read is skipped with a note
 * rather than silently attached or silently dropped. A mention that names
 * nothing readable — a typo, a directory, a binary — also reports, so the
 * message still goes out with its context minus the file, and the user learns
 * which. Mentions of the same file collapse to one attachment.
 */
export async function attachMentionedFiles(
  input: string,
  context: ToolContext,
  options: ExpandMentionOptions = {},
): Promise<MentionExpansion> {
  const attachments: MentionAttachment[] = []
  const notes: string[] = []
  const seen = new Set<string>()

  for (const token of extractMentions(input)) {
    const absPath = resolve(context.projectPath, token.path)
    if (seen.has(absPath)) continue
    seen.add(absPath)

    let stats
    try {
      stats = statSync(absPath)
    } catch {
      stats = null
    }
    if (!stats?.isFile()) {
      notes.push(
        stats?.isDirectory()
          ? `@${token.path} is a directory — only files can be attached.`
          : `@${token.path} does not exist — nothing to attach.`,
      )
      continue
    }

    if (await pathRequiresApproval({ path: token.path }, context)) {
      if (!options.requestApproval) {
        notes.push(`@${token.path} needs approval to read — not attached.`)
        continue
      }
      const approved = await options.requestApproval(token.path)
      if (!approved) {
        notes.push(`@${token.path} was not approved — not attached.`)
        continue
      }
    }

    let raw: string
    try {
      raw = readFileSync(absPath, "utf-8")
    } catch (error) {
      notes.push(`@${token.path} could not be read — ${errorDetail(error)}`)
      continue
    }
    if (raw.includes("\u0000")) {
      notes.push(`@${token.path} is binary — not attached.`)
      continue
    }

    attachments.push({
      path: relative(context.projectPath, absPath).replace(/\\/g, "/"),
      content: capResult(raw, MAX_ATTACHMENT_BYTES, "file mention"),
    })
  }

  return { attachments, notes }
}

/**
 * How one File Attachment reaches the Model: the content verbatim, inside a
 * tag naming the path, appended to the user's own words. No line numbers —
 * the attachment is the file as it is on disk, so an exact-string edit the
 * model copies out of it is an exact-string edit against the real file.
 */
export function composeFileAttachmentText(attachment: { path: string; content: string }): string {
  return `<file path="${attachment.path}">\n${attachment.content}\n</file>`
}
