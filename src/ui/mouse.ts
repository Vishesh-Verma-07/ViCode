export type WheelDirection = "up" | "down"

export const MOUSE_TRACKING_ENABLE = "\u001B[?1000h\u001B[?1006h"
export const MOUSE_TRACKING_DISABLE = "\u001B[?1000l\u001B[?1006l"

const WHEEL_SEQUENCE = /^\x1B?\[?<(\d+);\d+;\d+M$/

export function parseWheelEvent(input: string): WheelDirection | null {
  const match = WHEEL_SEQUENCE.exec(input)
  if (!match) return null
  const button = Number(match[1])
  if (button === 64) return "up"
  if (button === 65) return "down"
  return null
}

const MOUSE_JUNK = /<\d+;\d+;\d+[Mm]/g

export function scrubMouseSequences(text: string): string {
  return text.replace(MOUSE_JUNK, "")
}
