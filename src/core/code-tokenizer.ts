export type CodeSegment =
  | { kind: "prose"; text: string }
  | { kind: "inline-code"; text: string }
  | { kind: "fenced"; text: string; language?: string }

const OPEN_FENCE = /^`{3,}/
const CLOSE_FENCE = /^`{3,}$/

export function tokenizeCodeText(input: string): CodeSegment[] {
  const segments: CodeSegment[] = []
  const lines = input.split("\n")
  let pending: string[] = []
  let i = 0

  const flushProse = () => {
    const text = pending.join("\n")
    pending = []
    if (text) segments.push(...tokenizeInline(text))
  }

  while (i < lines.length) {
    const line = lines[i]!
    if (OPEN_FENCE.test(line.trim())) {
      flushProse()
      const language = line.trim().replace(/^`+/, "").trim() || undefined
      const body: string[] = []
      i++
      let closed = false
      for (; i < lines.length; i++) {
        if (CLOSE_FENCE.test(lines[i]!.trim())) {
          closed = true
          i++
          break
        }
        body.push(lines[i]!)
      }
      segments.push({ kind: "fenced", text: body.join("\n"), language })
      if (!closed) break
    } else {
      pending.push(line)
      i++
    }
  }
  flushProse()

  return segments
}

function tokenizeInline(text: string): CodeSegment[] {
  const result: CodeSegment[] = []
  let buffer = ""
  let rest = text

  while (rest.length > 0) {
    const open = rest.indexOf("`")
    if (open === -1) {
      buffer += rest
      break
    }
    buffer += rest.slice(0, open)
    const after = rest.slice(open + 1)
    const close = after.indexOf("`")
    if (close === -1) {
      buffer += `\`${after}`
      break
    }
    if (buffer) {
      result.push({ kind: "prose", text: buffer })
      buffer = ""
    }
    const inline = after.slice(0, close)
    if (inline) result.push({ kind: "inline-code", text: inline })
    rest = after.slice(close + 1)
  }
  if (buffer) result.push({ kind: "prose", text: buffer })

  return result
}