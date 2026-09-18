import { describe, it, expect } from "bun:test"
import { deletePreviousWord } from "@/ui/word-delete"

describe("deletePreviousWord", () => {
  it("removes the trailing word", () => {
    expect(deletePreviousWord("hello world foo")).toBe("hello world")
  })

  it("removes the trailing word and preceding spaces", () => {
    expect(deletePreviousWord("hello   world")).toBe("hello")
  })

  it("removes trailing whitespace plus the last word", () => {
    expect(deletePreviousWord("hello world  ")).toBe("hello")
  })

  it("empties a single-word string", () => {
    expect(deletePreviousWord("hello")).toBe("")
  })

  it("leaves leading-only whitespace untouched", () => {
    expect(deletePreviousWord("   ")).toBe("   ")
  })

  it("handles an empty string", () => {
    expect(deletePreviousWord("")).toBe("")
  })
})