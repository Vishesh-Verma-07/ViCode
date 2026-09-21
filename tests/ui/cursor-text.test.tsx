import React from "react"
import { describe, expect, it } from "bun:test"
import { render } from "ink-testing-library"
import { CursorText } from "@/ui/cursor-text"

function frameText(value: string, cursor: number): string {
  const instance = render(<CursorText value={value} cursor={cursor} placeholder="Type..." />)
  const text = (instance.lastFrame() ?? "").replace(/\u001b\[[0-9;]*m/g, "")
  instance.unmount()
  return text
}

describe("CursorText rendering", () => {
  it("renders the block cursor between the text halves at its offset", () => {
    const text = frameText("abc", 1)
    expect(text).toContain("a")
    expect(text).toContain("bc")
  })

  it("never splits an astral grapheme even with a mid-grapheme offset", () => {
    const text = frameText("a🚀b", 1)
    expect(text).toContain("a")
    expect(text).toContain("🚀b")
  })
})