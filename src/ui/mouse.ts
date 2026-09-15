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

const X10_PREFIX = "[M"
const X10_PAYLOAD_BYTES = 2
const MOUSE_SGR_INPUT = /^\[?<\d+;\d+;\d+[Mm]$/
const CONTROL_CHARACTERS = /[\x00-\x1f\x7f]/

export interface MouseInputFilterState {
  readonly payloadRemaining: number
}

export const MOUSE_INPUT_FILTER_INITIAL: MouseInputFilterState = { payloadRemaining: 0 }

export interface MouseInputFilterResult {
  readonly drop: boolean
  readonly state: MouseInputFilterState
}

export function filterMouseInput(
  input: string,
  state: MouseInputFilterState = MOUSE_INPUT_FILTER_INITIAL,
): MouseInputFilterResult {
  if (state.payloadRemaining > 0) {
    return { drop: true, state: { payloadRemaining: state.payloadRemaining - 1 } }
  }
  if (input === X10_PREFIX) {
    return { drop: true, state: { payloadRemaining: X10_PAYLOAD_BYTES } }
  }
  if (MOUSE_SGR_INPUT.test(input) || CONTROL_CHARACTERS.test(input)) {
    return { drop: true, state }
  }
  return { drop: false, state }
}
