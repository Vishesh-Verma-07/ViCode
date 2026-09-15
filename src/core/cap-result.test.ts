import { describe, it, expect } from "bun:test"
import {
  capResult,
  MAX_TOOL_RESULT_BYTES,
  VICODE_TRUNCATION_SENTINEL,
  TRUNCATION_MARKER_BYTES,
} from "./cap-result"

const encoder = new TextEncoder()
const strictDecoder = new TextDecoder("utf-8", { fatal: true })

function byteLength(s: string): number {
  return encoder.encode(s).length
}

describe("capResult", () => {
  it("returns results that already fit unchanged", () => {
    const small = "inline output"
    expect(capResult(small)).toBe(small)
  })

  it("caps an oversized result to at most the cap in bytes", () => {
    const big = "x".repeat(3 * MAX_TOOL_RESULT_BYTES)
    expect(byteLength(capResult(big))).toBeLessThanOrEqual(MAX_TOOL_RESULT_BYTES)
  })

  it("keeps the head and the tail and drops the middle", () => {
    const big = "HEAD" + "m".repeat(4 * MAX_TOOL_RESULT_BYTES) + "TAIL"
    const capped = capResult(big)
    expect(capped.startsWith("HEAD")).toBe(true)
    expect(capped.endsWith("TAIL")).toBe(true)
    expect(capped).not.toContain("m".repeat(3 * MAX_TOOL_RESULT_BYTES))
  })

  it("appends a marker stating the omitted byte count and re-query instruction", () => {
    const big = "a".repeat(3 * MAX_TOOL_RESULT_BYTES)
    const capped = capResult(big)
    expect(capped).toContain(VICODE_TRUNCATION_SENTINEL)
    const match = capped.match(/(\d+) bytes omitted/)
    expect(match).not.toBeNull()
    expect(Number(match?.[1])).toBeGreaterThan(0)
    expect(capped).toMatch(/re-?quer/i)
    expect(TRUNCATION_MARKER_BYTES).toBeGreaterThan(0)
  })

  it("is deterministic", () => {
    const big = "b".repeat(3 * MAX_TOOL_RESULT_BYTES)
    expect(capResult(big)).toBe(capResult(big))
  })

  it("honors an explicit cap argument", () => {
    const big = "y".repeat(3 * MAX_TOOL_RESULT_BYTES)
    const capped = capResult(big, 1024)
    expect(byteLength(capped)).toBeLessThanOrEqual(1024)
  })

  it("never splits a multi-byte UTF-8 character", () => {
    const emoji = "😀".repeat(2 * MAX_TOOL_RESULT_BYTES) // 4 bytes each
    const capped = capResult(emoji)
    expect(capped.length).toBeGreaterThan(0)
    expect(() => strictDecoder.decode(encoder.encode(capped))).not.toThrow()
  })
})
