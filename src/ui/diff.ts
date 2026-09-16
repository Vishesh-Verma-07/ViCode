export type DiffLineKind = "header" | "hunk" | "context" | "add" | "remove" | "meta"

export interface DiffLine {
  kind: DiffLineKind
  text: string
  oldLine: number | null
  newLine: number | null
}

export interface ParsedDiff {
  oldPath: string | null
  newPath: string | null
  added: number
  removed: number
  lines: DiffLine[]
}

const HUNK_RE = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/

export function parseDiff(diff: string): ParsedDiff {
  const parsed: ParsedDiff = { oldPath: null, newPath: null, added: 0, removed: 0, lines: [] }
  const lines = diff.split("\n")
  if (lines[lines.length - 1] === "") lines.pop()

  let oldNum: number | null = null
  let newNum: number | null = null

  for (const raw of lines) {
    if (/^Index: /.test(raw) || /^=+$/.test(raw)) {
      continue
    }
    if (raw.startsWith("--- ")) {
      parsed.oldPath = raw.slice(4).replace(/^[ab]\//, "").trim() || null
      parsed.lines.push({ kind: "header", text: raw, oldLine: null, newLine: null })
      continue
    }
    if (raw.startsWith("+++ ")) {
      parsed.newPath = raw.slice(4).replace(/^[ab]\//, "").trim() || null
      parsed.lines.push({ kind: "header", text: raw, oldLine: null, newLine: null })
      continue
    }
    const hunk = HUNK_RE.exec(raw)
    if (hunk) {
      oldNum = Number(hunk[1])
      newNum = Number(hunk[3])
      parsed.lines.push({ kind: "hunk", text: raw, oldLine: null, newLine: null })
      continue
    }
    if (raw.startsWith("\\")) {
      parsed.lines.push({ kind: "meta", text: raw, oldLine: null, newLine: null })
      continue
    }
    if (raw.startsWith("+")) {
      parsed.added++
      parsed.lines.push({ kind: "add", text: raw, oldLine: null, newLine: newNum ?? null })
      if (newNum !== null) newNum++
      continue
    }
    if (raw.startsWith("-")) {
      parsed.removed++
      parsed.lines.push({ kind: "remove", text: raw, oldLine: oldNum ?? null, newLine: null })
      if (oldNum !== null) oldNum++
      continue
    }
    if (raw.startsWith(" ") || raw === "") {
      parsed.lines.push({ kind: "context", text: raw, oldLine: oldNum ?? null, newLine: newNum ?? null })
      if (oldNum !== null) oldNum++
      if (newNum !== null) newNum++
      continue
    }
    parsed.lines.push({ kind: "meta", text: raw, oldLine: null, newLine: null })
  }

  return parsed
}