/** The part of a transcript block the pointer needs in order to name a message. */
export interface TranscriptLineBlock {
  lines: number
  messageId?: string
}

/**
 * Names the message that owns a transcript line, counting from the first block
 * on 0. Rows belonging to running tools, feedback or streamed text have no
 * message id, so a pointer over them names nothing rather than the nearest
 * message.
 */
export function messageIdAtLine(
  blocks: readonly TranscriptLineBlock[],
  line: number,
): string | undefined {
  if (line < 0) return undefined
  let start = 0
  for (const block of blocks) {
    const end = start + block.lines
    if (line < end) return block.messageId
    start = end
  }
  return undefined
}
