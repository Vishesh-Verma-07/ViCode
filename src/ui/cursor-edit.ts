export interface CursorState {
  text: string
  cursor: number
}

export function splitGraphemes(text: string): string[] {
  if (typeof Intl === "undefined" || typeof Intl.Segmenter === "undefined") {
    return Array.from(text)
  }
  const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" })
  const segments: string[] = []
  for (const part of segmenter.segment(text)) segments.push(part.segment)
  return segments
}

export function normalizeCursor(text: string, cursor: number): number {
  let c = Math.max(0, Math.min(cursor, text.length))
  let pos = 0
  for (const grapheme of splitGraphemes(text)) {
    if (pos + grapheme.length > c) return pos
    pos += grapheme.length
  }
  return pos
}

export function moveLeft(text: string, cursor: number): CursorState {
  const c = normalizeCursor(text, cursor)
  if (c <= 0) return { text, cursor: 0 }
  let pos = 0
  for (const grapheme of splitGraphemes(text)) {
    if (pos + grapheme.length >= c) return { text, cursor: pos }
    pos += grapheme.length
  }
  return { text, cursor: 0 }
}

export function moveRight(text: string, cursor: number): CursorState {
  const c = normalizeCursor(text, cursor)
  let pos = 0
  for (const grapheme of splitGraphemes(text)) {
    if (c < pos + grapheme.length) return { text, cursor: pos + grapheme.length }
    pos += grapheme.length
  }
  return { text, cursor: text.length }
}

export function moveToHome(text: string, _cursor: number): CursorState {
  return { text, cursor: 0 }
}

export function moveToEnd(text: string, _cursor: number): CursorState {
  return { text, cursor: text.length }
}

export function insertAt(text: string, cursor: number, chunk: string): CursorState {
  if (!chunk) return { text, cursor: normalizeCursor(text, cursor) }
  const c = normalizeCursor(text, cursor)
  return { text: text.slice(0, c) + chunk + text.slice(c), cursor: c + chunk.length }
}

export function backspaceAt(text: string, cursor: number): CursorState {
  const c = normalizeCursor(text, cursor)
  if (c <= 0) return { text, cursor: 0 }
  const prev = moveLeft(text, c)
  return { text: text.slice(0, prev.cursor) + text.slice(c), cursor: prev.cursor }
}

export function deleteAt(text: string, cursor: number): CursorState {
  const c = normalizeCursor(text, cursor)
  const next = moveRight(text, c)
  if (next.cursor === c) return { text, cursor: c }
  return { text: text.slice(0, c) + text.slice(next.cursor), cursor: c }
}

export function wordDeleteAt(text: string, cursor: number): CursorState {
  const c = normalizeCursor(text, cursor)
  const midWord = c > 0 && c < text.length && !/\s/.test(text.charAt(c - 1)) && !/\s/.test(text.charAt(c))
  if (midWord) {
    let start = c
    while (start > 0 && !/\s/.test(text.charAt(start - 1))) start--
    return { text: text.slice(0, start) + text.slice(c), cursor: start }
  }
  let end = c
  while (end > 0 && /\s/.test(text.charAt(end - 1))) end--
  let wordStart = end
  while (wordStart > 0 && !/\s/.test(text.charAt(wordStart - 1))) wordStart--
  if (wordStart === end) return { text, cursor: c }
  let start = wordStart
  while (start > 0 && /\s/.test(text.charAt(start - 1))) start--
  let keep = c
  while (keep < text.length && /\s/.test(text.charAt(keep))) keep++
  return { text: text.slice(0, start) + text.slice(keep), cursor: start }
}

export function clampToEnd(text: string): CursorState {
  return { text, cursor: text.length }
}