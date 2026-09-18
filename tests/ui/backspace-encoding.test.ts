import { describe, it, expect } from "bun:test"
import { rewriteBackspaceEncoding } from "@/ui/backspace-encoding"

describe("rewriteBackspaceEncoding", () => {
  it.each([
    Buffer.from([0x7f]),
    Buffer.from("\x7f", "utf8"),
  ])("rewrites a lone DEL (0x7f) byte to the Ctrl+Delete sequence", (chunk) => {
    expect(rewriteBackspaceEncoding(chunk)).toEqual(
      Buffer.from([0x1b, 0x5b, 0x33, 0x3b, 0x35, 0x7e]),
    )
  })

  it("rewrites a lone DEL string chunk", () => {
    expect(rewriteBackspaceEncoding("\u007f")).toEqual(
      Buffer.from([0x1b, 0x5b, 0x33, 0x3b, 0x35, 0x7e]),
    )
  })

  it("leaves the BS (0x08) byte unchanged", () => {
    expect(rewriteBackspaceEncoding(Buffer.from([0x08]))).toEqual(
      Buffer.from([0x08]),
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