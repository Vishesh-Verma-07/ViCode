import React from "react"
import { describe, it, expect } from "bun:test"
import { render } from "ink-testing-library"
import { renderToString, Box, Text } from "ink"
import chalk from "../../node_modules/ink/node_modules/chalk/source/index.js"
import { ModeInputBox } from "@/ui/mode-input-box"
import { findMode, MODES, type ModeId } from "@/core/modes"
import { COLORS } from "@/ui/theme"

chalk.level = 3

function frame(instance: { lastFrame: () => string | undefined }): string {
  return instance.lastFrame() ?? ""
}

function plain(text: string): string {
  return text.replace(/\u001B\[[0-9;]*m/g, "")
}

function rows(node: React.ReactElement, columns: number): string[] {
  return plain(renderToString(node, { columns })).split("\n")
}

describe("ModeInputBox", () => {
  it("renders the Mode Switcher alongside the input children", () => {
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

  it("shows every Mode name, with only the active one bracketed", () => {
    const inst = render(
      <ModeInputBox mode={findMode("plan")!}>
        <Text>draft</Text>
      </ModeInputBox>,
    )
    const out = plain(frame(inst))
    for (const mode of MODES) {
      expect(out).toContain(mode.name)
    }
    expect(out).toContain("[Plan]")
    expect(out).not.toContain("[Build]")
    expect(out).not.toContain("[Discuss]")
    inst.unmount()
  })

  it("keeps the switcher and the draft on separate rows", () => {
    const lines = rows(
      <ModeInputBox mode={findMode("build")!}>
        <Text>draft</Text>
      </ModeInputBox>,
      40,
    )
    const switcherRow = lines.findIndex((line) => line.trim().includes("[Build]"))
    const draftRow = lines.findIndex((line) => line.trim().includes("draft"))
    expect(switcherRow).toBeGreaterThanOrEqual(0)
    expect(draftRow).toBe(switcherRow + 1)
  })

  it("keeps the switcher row intact instead of merging it with the draft when the container is too short", () => {
    const lines = rows(
      <Box height={2} flexDirection="column" width={40}>
        <ModeInputBox mode={findMode("build")!}>
          <Text>draft</Text>
        </ModeInputBox>
      </Box>,
      40,
    )
    const switcherRow = lines.findIndex((line) => line.trim().includes("[Build]"))
    expect(switcherRow).toBeGreaterThanOrEqual(0)
    expect(lines[switcherRow]!.trim()).toBe("[Build] Discuss Plan")
  })

  it("leaves one column for the left-edge bar in every Mode", () => {
    for (const id of MODES.map((mode) => mode.id)) {
      const lines = rows(
        <ModeInputBox mode={findMode(id as ModeId)!}>
          <Text>draft</Text>
        </ModeInputBox>,
        100,
      )
      const stripLine = lines.find((line) => line.includes(`[${findMode(id as ModeId)!.name}]`)) ?? ""
      expect(stripLine.length - stripLine.trimStart().length).toBe(3)
    }
  })

  it("paints the left-edge bar and the switcher in the mode's design-token color (build blue)", () => {
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
