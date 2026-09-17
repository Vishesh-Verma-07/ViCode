import React from "react"
import { describe, it, expect } from "bun:test"
import { renderToString } from "ink"
import { WelcomeScreen } from "@/ui/welcome"
import { COLORS } from "@/ui/theme"
import { ansiCode } from "@/ui/ansi-test"
import type { Provider } from "@/core/provider"

const provider: Provider = {
  getModelInfo: () => ({ id: "stub-model", name: "stub-model" }),
  async listModels() {
    return []
  },
  async *streamChat() {},
}

describe("WelcomeScreen banner colorization", () => {
  it("renders the centered ViCode banner colorized with the primary accent", () => {
    const frame = renderToString(
      <WelcomeScreen provider={provider} onNewChat={() => {}} onSendFirstMessage={() => {}} />,
      { columns: 100 },
    )

    const bannerLine = "  ██╗   ██╗██╗███████╗██╗    ███████╗"
    expect(frame).toContain(bannerLine)

    const bannerStart = frame.indexOf(bannerLine)
    expect(bannerStart).toBeGreaterThanOrEqual(0)
    const bannerPrefix = frame.slice(Math.max(0, bannerStart - 80), bannerStart + 10)
    expect(bannerPrefix).toContain(ansiCode(COLORS.primary))
  })

  it("keeps the banner centered under a wide terminal", () => {
    const frame = renderToString(
      <WelcomeScreen provider={provider} onNewChat={() => {}} onSendFirstMessage={() => {}} />,
      { columns: 120 },
    )
    const line = frame.split("\n").find((l) => l.includes("██╗   ██╗")) ?? ""
    const leadingSpaces = line.length - line.trimStart().length
    expect(leadingSpaces).toBeGreaterThan(2)
    expect(line.length).toBeLessThan(120)
  })
})