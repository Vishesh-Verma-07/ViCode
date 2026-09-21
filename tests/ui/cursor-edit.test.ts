import { describe, expect, it } from "bun:test"
import {
  backspaceAt,
  clampToEnd,
  deleteAt,
  insertAt,
  moveLeft,
  moveRight,
  moveToEnd,
  moveToHome,
  normalizeCursor,
  wordDeleteAt,
} from "@/ui/cursor-edit"

describe("cursor edit core", () => {
  describe("normalizeCursor", () => {
    it("clamps to the text length", () => {
      expect(normalizeCursor("abc", 99)).toBe(3)
      expect(normalizeCursor("abc", -5)).toBe(0)
    })

    it("snaps a mid-grapheme cursor back to the containing boundary", () => {
      expect(normalizeCursor("🚀ab", 1)).toBe(0)
      expect(normalizeCursor("🚀ab", 3)).toBe(3)
    })
  })

  describe("moveLeft / moveRight", () => {
    it("moves one grapheme at a time", () => {
      expect(moveLeft("abc", 2)).toEqual({ text: "abc", cursor: 1 })
      expect(moveRight("abc", 1)).toEqual({ text: "abc", cursor: 2 })
    })

    it("moves across astral characters as a single unit", () => {
      expect(moveLeft("a🚀b", 4)).toEqual({ text: "a🚀b", cursor: 3 })
      expect(moveLeft("a🚀b", 3)).toEqual({ text: "a🚀b", cursor: 1 })
      expect(moveRight("a🚀b", 1)).toEqual({ text: "a🚀b", cursor: 3 })
    })

    it("treats an emoji family as a single step", () => {
      const family = "👨‍👩‍👧"
      expect(moveLeft(family + "x", family.length + 1).cursor).toBe(8)
      expect(moveLeft(family + "x", 8).cursor).toBe(0)
      expect(moveRight("", 0)).toEqual({ text: "", cursor: 0 })
    })

    it("clamps at the edges", () => {
      expect(moveLeft("abc", 0)).toEqual({ text: "abc", cursor: 0 })
      expect(moveRight("abc", 3)).toEqual({ text: "abc", cursor: 3 })
    })
  })

  describe("moveToHome / moveToEnd", () => {
    it("jumps to the start and end", () => {
      expect(moveToHome("abc", 2)).toEqual({ text: "abc", cursor: 0 })
      expect(moveToEnd("abc", 1)).toEqual({ text: "abc", cursor: 3 })
    })
  })

  describe("insertAt", () => {
    it("inserts at the cursor, not the end", () => {
      expect(insertAt("abc", 1, "XY")).toEqual({ text: "aXYbc", cursor: 3 })
    })

    it("appends when the cursor is at the end", () => {
      expect(insertAt("abc", 3, "d")).toEqual({ text: "abcd", cursor: 4 })
    })

    it("is a no-op for an empty chunk but still normalizes the cursor", () => {
      expect(insertAt("abc", 5, "")).toEqual({ text: "abc", cursor: 3 })
    })
  })

  describe("backspaceAt", () => {
    it("removes the grapheme before the cursor", () => {
      expect(backspaceAt("abc", 1)).toEqual({ text: "bc", cursor: 0 })
    })

    it("removes a whole astral character, not half of it", () => {
      expect(backspaceAt("a🚀b", 3)).toEqual({ text: "ab", cursor: 1 })
    })

    it("is a no-op at the start", () => {
      expect(backspaceAt("abc", 0)).toEqual({ text: "abc", cursor: 0 })
    })
  })

  describe("deleteAt", () => {
    it("removes the grapheme under the cursor", () => {
      expect(deleteAt("abc", 1)).toEqual({ text: "ac", cursor: 1 })
    })

    it("removes a whole astral character", () => {
      expect(deleteAt("a🚀b", 1)).toEqual({ text: "ab", cursor: 1 })
    })

    it("is a no-op at the end", () => {
      expect(deleteAt("abc", 3)).toEqual({ text: "abc", cursor: 3 })
    })
  })

  describe("wordDeleteAt", () => {
    it("deletes backwards over the previous word including the gap", () => {
      expect(wordDeleteAt("hello world foo", 15)).toEqual({ text: "hello world", cursor: 11 })
    })

    it("cuts back to the start of the current word when mid-word", () => {
      expect(wordDeleteAt("hello world", 9)).toEqual({ text: "hello ld", cursor: 6 })
    })

    it("deletes the leading word at the start", () => {
      expect(wordDeleteAt("abc", 3)).toEqual({ text: "", cursor: 0 })
    })

    it("leaves whitespace-only drafts untouched", () => {
      expect(wordDeleteAt("   ", 3)).toEqual({ text: "   ", cursor: 3 })
    })

    it("is a no-op on an empty draft", () => {
      expect(wordDeleteAt("", 0)).toEqual({ text: "", cursor: 0 })
    })
  })

  describe("clampToEnd", () => {
    it("lands the cursor at the end (external value replacement)", () => {
      expect(clampToEnd("replacement")).toEqual({ text: "replacement", cursor: 11 })
    })
  })
})