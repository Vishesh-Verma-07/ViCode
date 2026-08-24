import { describe, it, expect } from "bun:test"
import { parseWheelEvent, scrubMouseSequences, MOUSE_TRACKING_ENABLE, MOUSE_TRACKING_DISABLE } from "./mouse"

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

describe("scrubMouseSequences", () => {
  it("removes embedded wheel sequences", () => {
    expect(scrubMouseSequences("hello <64;12;30M world")).toBe("hello  world")
  })

  it("removes multiple sequences", () => {
    expect(scrubMouseSequences("<64;1;1M<65;2;2M<0;3;3Mx")).toBe("x")
  })

  it("leaves clean text untouched", () => {
    expect(scrubMouseSequences("plain text")).toBe("plain text")
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
