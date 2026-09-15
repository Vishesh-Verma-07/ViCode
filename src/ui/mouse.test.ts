import { describe, it, expect } from "bun:test"
import { parseWheelEvent, MOUSE_TRACKING_ENABLE, MOUSE_TRACKING_DISABLE, filterMouseInput, MOUSE_INPUT_FILTER_INITIAL } from "./mouse"

describe("parseWheelEvent", () => {
  it("detects wheel-up (button 64 press)", () => {
    expect(parseWheelEvent("<64;10;5M")).toBe("up")
  })

  it("detects wheel-down (button 65 press)", () => {
    expect(parseWheelEvent("<65;10;5M")).toBe("down")
  })

  it("tolerates a leading escape/CSI prefix", () => {
    expect(parseWheelEvent("\x1B[<64;1;1M")).toBe("up")
    expect(parseWheelEvent("[<65;1;1M")).toBe("down")
  })

  it("ignores non-wheel button presses", () => {
    expect(parseWheelEvent("<0;10;5M")).toBeNull()
    expect(parseWheelEvent("<32;10;5M")).toBeNull()
  })

  it("ignores release events (lowercase m)", () => {
    expect(parseWheelEvent("<64;10;5m")).toBeNull()
    expect(parseWheelEvent("<65;10;5m")).toBeNull()
  })

  it("ignores ordinary input", () => {
    expect(parseWheelEvent("hello")).toBeNull()
    expect(parseWheelEvent("")).toBeNull()
    expect(parseWheelEvent("\r")).toBeNull()
  })
})

describe("mouse tracking sequences", () => {
  it("enable enables SGR + button tracking; disable undoes it", () => {
    expect(MOUSE_TRACKING_ENABLE).toContain("\u001B[?1000h")
    expect(MOUSE_TRACKING_ENABLE).toContain("\u001B[?1006h")
    expect(MOUSE_TRACKING_DISABLE).toContain("\u001B[?1000l")
    expect(MOUSE_TRACKING_DISABLE).toContain("\u001B[?1006l")
  })
})

describe("filterMouseInput", () => {
  function feed(inputs: string[], initial = MOUSE_INPUT_FILTER_INITIAL) {
    let state = initial
    const kept: string[] = []
    for (const input of inputs) {
      const result = filterMouseInput(input, state)
      state = result.state
      kept.push(result.keptInput)
    }
    return { kept, state }
  }

  function keptCat(inputs: string[], initial = MOUSE_INPUT_FILTER_INITIAL) {
    return feed(inputs, initial).kept.join("")
  }

  it("drops the [M prefix and the two X10 payload bytes that follow it", () => {
    const prefix = filterMouseInput("[M", MOUSE_INPUT_FILTER_INITIAL)
    expect(prefix.keptInput).toBe("")
    expect(prefix.state.payloadRemaining).toBe(2)

    const byte1 = filterMouseInput("!", prefix.state)
    expect(byte1.keptInput).toBe("")
    expect(byte1.state.payloadRemaining).toBe(1)

    const byte2 = filterMouseInput("!", byte1.state)
    expect(byte2.keptInput).toBe("")
    expect(byte2.state.payloadRemaining).toBe(0)
  })

  it("rejects SGR-form mouse sequences", () => {
    for (const sgr of ["<0;10;5M", "[<0;10;5M", "\u001B[<0;10;5M", "<64;10;5M"]) {
      const result = filterMouseInput(sgr, MOUSE_INPUT_FILTER_INITIAL)
      expect(result.keptInput).toBe("")
    }
  })

  it("rejects control characters", () => {
    for (const control of ["\r", "\n", "\u0000", "\u001b", "\u007f"]) {
      const result = filterMouseInput(control, MOUSE_INPUT_FILTER_INITIAL)
      expect(result.keptInput).toBe("")
    }
  })

  it("passes ordinary printable keystrokes through when not armed", () => {
    const { kept, state } = feed(["h", "e", "l", "l", "o"])
    expect(kept.join("")).toBe("hello")
    expect(state).toEqual(MOUSE_INPUT_FILTER_INITIAL)
  })

  it("preserves a real keystroke interleaved among payload bytes once the arm is spent", () => {
    expect(keptCat(["[M", "q", "w", "t"])).toBe("t")
  })

  it("consumes a real keystroke arriving while a payload byte is still armed", () => {
    expect(keptCat(["[M", "a", "!", "."])).toBe(".")
  })

  it("fully ignores multiple consecutive clicks while preserving typed characters", () => {
    expect(keptCat(["[M", "a", "b", "h", "i", "[M", "c", "d", "x", "y"])).toBe("hixy")
  })

  it("consumes bundles no larger than the arm and keeps later typing", () => {
    const bundled = filterMouseInput("[M", MOUSE_INPUT_FILTER_INITIAL)
    expect(bundled.keptInput).toBe("")
    expect(bundled.state.payloadRemaining).toBe(2)

    const chunk = filterMouseInput("!!", bundled.state)
    expect(chunk.keptInput).toBe("")
    expect(chunk.state.payloadRemaining).toBe(0)
  })

  it("drops a coalesced payload bundle larger than the arm in full", () => {
    const chunk = filterMouseInput(" !!", { payloadRemaining: 2 })
    expect(chunk.keptInput).toBe("")
    expect(chunk.state).toEqual(MOUSE_INPUT_FILTER_INITIAL)
    const chunkSpent = filterMouseInput("\\x1b", { payloadRemaining: 1 })
    expect(chunkSpent.keptInput).toBe("")
    expect(chunkSpent.state).toEqual(MOUSE_INPUT_FILTER_INITIAL)
  })

  it("passes nothing through once the arm is exhausted by a bundle", () => {
    expect(keptCat(["[M", "!!", "x"])).toBe("x")
    expect(keptCat(["[M", " !!", "x"])).toBe("x")
  })
})
