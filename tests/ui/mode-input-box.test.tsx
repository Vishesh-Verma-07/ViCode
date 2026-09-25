import React from "react"
import { describe, it, expect } from "bun:test"
import { render } from "ink-testing-library"
import { Text } from "ink"
import chalk from "../../node_modules/ink/node_modules/chalk/source/index.js"
import { ModeInputBox } from "@/ui/mode-input-box"
import { findMode } from "@/core/modes"
import { COLORS } from "@/ui/theme"

chalk.level = 3

function frame(instance: { lastFrame: () => string | undefined }): string {
  return instance.lastFrame() ?? ""
}

describe("ModeInputBox", () => {
  it("renders the Mode Tag alongside the input children", () => {
    const inst = render(
      <ModeInputBox mode={findMode("build")!}>
        <Text>draft text</Text>
      </ModeInputBox>,
    )
    const out = frame(inst)
    expect(out).toContain("[Build]")
    expect(out).toContain("draft text")
    inst.unmount()
  })

  it("paints the left-edge bar and the chip in the mode's design-token color (build blue)", () => {
    const inst = render(
      <ModeInputBox mode={findMode("build")!}>
        <Text>draft</Text>
      </ModeInputBox>,
    )
    const out = frame(inst)
    expect(out).toContain("\u001B[44m")
    expect(out).toContain("\u001B[34m")
    inst.unmount()
  })

  it("uses distinct design-token colors for discuss (purple) and plan (orange)", () => {
    expect(COLORS.modeDiscuss).toBe("#a855f7")
    expect(COLORS.modePlan).toBe("#f97316")

    const discuss = render(
      <ModeInputBox mode={findMode("discuss")!}>
        <Text>draft</Text>
      </ModeInputBox>,
    )
    const discussOut = frame(discuss)
    expect(discussOut).toContain("38;2;168;85;247")
    expect(discussOut).toContain("48;2;168;85;247")
    discuss.unmount()

    const plan = render(
      <ModeInputBox mode={findMode("plan")!}>
        <Text>draft</Text>
      </ModeInputBox>,
    )
    const planOut = frame(plan)
    expect(planOut).toContain("38;2;249;115;22")
    expect(planOut).toContain("48;2;249;115;22")
    plan.unmount()
  })

  it("falls back to the plain input shade box when no mode is given", () => {
    const inst = render(
      <ModeInputBox>
        <Text>draft text</Text>
      </ModeInputBox>,
    )
    const out = frame(inst)
    expect(out).toContain("draft text")
    expect(out).not.toContain("[Build]")
    inst.unmount()
  })
})