import { describe, it, expect } from "bun:test"
import { rewriteBackspaceEncoding } from "@/ui/backspace-encoding"

describe("rewriteBackspaceEncoding", () => {
  it.each([
    Buffer.from([0x08]),
    Buffer.from("\x08", "utf8"),
  ])("rewrites a lone BS (0x08) byte to the Ctrl+Delete sequence", (chunk) => {
    expect(rewriteBackspaceEncoding(chunk)).toEqual(
      Buffer.from([0x1b, 0x5b, 0x33, 0x3b, 0x35, 0x7e]),
    )
  })

  it("rewrites a lone BS string chunk", () => {
    expect(rewriteBackspaceEncoding("\u0008")).toEqual(
      Buffer.from([0x1b, 0x5b, 0x33, 0x3b, 0x35, 0x7e]),
    )
  })

  it("leaves the DEL (0x7f) byte unchanged so plain Backspace deletes a single character", () => {
    expect(rewriteBackspaceEncoding(Buffer.from([0x7f]))).toEqual(
      Buffer.from([0x7f]),
    )
  })

  it("leaves multi-byte chunks (Alt+Backspace) unchanged", () => {
    const chunk = "\x1b\x7f"
    expect(rewriteBackspaceEncoding(chunk)).toBe(chunk)
    expect(rewriteBackspaceEncoding(Buffer.from([0x1b, 0x7f]))).toEqual(
      Buffer.from([0x1b, 0x7f]),
    )
  })

  it("leaves regular text unchanged", () => {
    const buf = Buffer.from("hello world", "utf8")
    expect(rewriteBackspaceEncoding(buf)).toBe(buf)
  })
})