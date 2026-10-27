export type WheelDirection = "up" | "down"

// 1002, not 1000: a drag needs to know where the button moved, but only while
// it is held. Hover tracking (1003) stays off, so moving the pointer without a
// button still costs nothing.
export const MOUSE_TRACKING_ENABLE = "\u001B[?1002h\u001B[?1006h"
export const MOUSE_TRACKING_DISABLE = "\u001B[?1002l\u001B[?1006l"

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

export type MouseButton = "left" | "middle" | "right" | "wheel-up" | "wheel-down"

export type MouseEventKind = "press" | "release" | "move"

/** One SGR mouse report, decoded. Coordinates are the terminal's 1-based cells. */
export interface ParsedMouseEvent {
  kind: MouseEventKind
  button: MouseButton
  column: number
  row: number
}

const SGR_MOUSE_EVENT_ANY = /(?:\x1B)?\[?<(\d+);(\d+);(\d+)([Mm])/g

/**
 * Reads every SGR mouse report out of one input chunk, including motion while
 * the left button is held. `parseMouseClick` deliberately stops at the first
 * press because the Tab Bar cares about a single pointer-down; a drag needs the
 * whole sequence.
 */
export function parseMouseEvents(input: string): ParsedMouseEvent[] {
  SGR_MOUSE_EVENT_ANY.lastIndex = 0
  const events: ParsedMouseEvent[] = []
  for (let match = SGR_MOUSE_EVENT_ANY.exec(input); match; match = SGR_MOUSE_EVENT_ANY.exec(input)) {
    const code = Number(match[1])
    const column = Number(match[2])
    const row = Number(match[3])
    const released = match[4] === "m"

    // Bit 6 selects the wheel; the low two bits pick the direction.
    if ((code & 64) !== 0) {
      const wheel = code & 3
      if (released || (wheel !== 0 && wheel !== 1)) continue
      events.push({ kind: "press", button: wheel === 0 ? "wheel-up" : "wheel-down", column, row })
      continue
    }

    // Low two bits: 0 left, 1 middle, 2 right, 3 no button.
    const button = code & 3
    if (button === 3) continue
    const kind: MouseEventKind = released ? "release" : (code & 32) !== 0 ? "move" : "press"
    events.push({
      kind,
      button: button === 0 ? "left" : button === 1 ? "middle" : "right",
      column,
      row,
    })
  }
  return events
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
