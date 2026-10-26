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

/** A left-button press, in the terminal's 1-based cell coordinates. */
export interface MouseClick {
  column: number
  row: number
}

// Unanchored because Ink strips the leading escape and one read can carry more
// than one event; the first click in the chunk is the one the user meant.
const SGR_MOUSE_EVENT = /(?:\x1B)?\[?<(\d+);(\d+);(\d+)([Mm])/g

/**
 * Reads the first left-button press out of an input chunk. Wheel, motion,
 * middle/right buttons and releases are not clicks: the Tab Bar reacts only to
 * a pointer that went down on it.
 */
export function parseMouseClick(input: string): MouseClick | null {
  SGR_MOUSE_EVENT.lastIndex = 0
  for (let match = SGR_MOUSE_EVENT.exec(input); match; match = SGR_MOUSE_EVENT.exec(input)) {
    const button = Number(match[1])
    const released = match[4] === "m"
    if (released) continue
    // Bit 5 marks motion and 64+ is the wheel; both use the left-button code.
    if (button >= 64 || (button & 32) !== 0) continue
    // The low two bits are the button number: 0 is the left one.
    if ((button & 3) !== 0) continue
    return { column: Number(match[2]), row: Number(match[3]) }
  }
  return null
}

const X10_PREFIX = "[M"
const X10_PAYLOAD_BYTES = 2
const MOUSE_SGR_INPUT = /^\[?<\d+;\d+;\d+[Mm]$/
const CONTROL_CHARACTERS = /[\x00-\x1f\x7f]/

export interface MouseInputFilterState {
  readonly payloadRemaining: number
}

export const MOUSE_INPUT_FILTER_INITIAL: MouseInputFilterState = { payloadRemaining: 0 }

export interface MouseInputFilterResult {
  readonly keptInput: string
  readonly state: MouseInputFilterState
}

export function filterMouseInput(
  input: string,
  state: MouseInputFilterState = MOUSE_INPUT_FILTER_INITIAL,
): MouseInputFilterResult {
  if (state.payloadRemaining > 0) {
    if (input.length > state.payloadRemaining) {
      return { keptInput: "", state: MOUSE_INPUT_FILTER_INITIAL }
    }
    return { keptInput: "", state: { payloadRemaining: state.payloadRemaining - input.length } }
  }
  if (input === X10_PREFIX) {
    return { keptInput: "", state: { payloadRemaining: X10_PAYLOAD_BYTES } }
  }
  if (MOUSE_SGR_INPUT.test(input) || CONTROL_CHARACTERS.test(input)) {
    return { keptInput: "", state }
  }
  return { keptInput: input, state }
}
