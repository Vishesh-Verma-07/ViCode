import React from "react"
import { describe, it, expect } from "bun:test"
import { render } from "ink-testing-library"
import { ConfirmPrompt } from "@/ui/confirm-prompt"

describe("ConfirmPrompt", () => {
  const warning =
    "This conversation is about 60.1k tokens — 188% of the 32.0k context window of " +
    "openrouter/narrow-beta, which leaves 22.4k to send. History will be compacted " +
    "or truncated on the next turn. Switch anyway?"

  it("shows the whole warning rather than trimming it to fit the box", () => {
    const instance = render(<ConfirmPrompt message={warning} confirmLabel="Switch" />)
    const frame = (instance.lastFrame() ?? "").replace(/\u001B\[[0-9;]*m/g, "")

    // Every figure the user is being asked to accept, not just the headline.
    expect(frame).toContain("60.1k")
    expect(frame).toContain("188%")
    expect(frame).toContain("32.0k")
    expect(frame).toContain("22.4k")
    expect(frame).toContain("openrouter/narrow-beta")
    expect(frame).toContain("compacted or truncated")
    expect(frame).toContain("the next turn. Switch anyway?")
    expect(frame).toContain("Switch anyway?")
    instance.unmount()
  })

  it("names what y agrees to, so the keys are not the only clue", () => {
    const instance = render(<ConfirmPrompt message={warning} confirmLabel="Switch" />)
    const frame = (instance.lastFrame() ?? "").replace(/\u001B\[[0-9;]*m/g, "")

    expect(frame).toContain("[y] Switch")
    expect(frame).toContain("[n] Cancel")
    instance.unmount()
  })

  it("admits Escape cancels, so the prompt is not a trap", () => {
    const instance = render(<ConfirmPrompt message={warning} confirmLabel="Switch" />)
    const frame = (instance.lastFrame() ?? "").replace(/\u001B\[[0-9;]*m/g, "")

    expect(frame).toContain("Esc also cancels.")
    instance.unmount()
  })
})
