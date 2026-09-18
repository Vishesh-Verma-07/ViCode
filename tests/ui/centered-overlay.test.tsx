import React from "react"
import { describe, it, expect } from "bun:test"
import { render } from "ink-testing-library"
import { Box, Text } from "ink"
import { CenteredOverlay } from "@/ui/centered-overlay"

describe("CenteredOverlay", () => {
  it("places its child in the middle of the given viewport", () => {
    const instance = render(
      <Box flexDirection="column" width={80} height={24}>
        <Box flexGrow={1}>
          <Text>underlay</Text>
        </Box>
        <CenteredOverlay width={80} height={24}>
          <Box width={20} height={5} borderStyle="round">
            <Text>CENTER</Text>
          </Box>
        </CenteredOverlay>
      </Box>,
    )
    const lines = (instance.lastFrame() ?? "")
      .replace(/\u001B\[[0-9;]*m/g, "")
      .split("\n")

    const topRow = lines.findIndex((l) => l.includes("╭"))
    const bottomRow = lines.findIndex((l) => l.includes("╰"))
    const topBorder = lines[topRow]!

    const topPadding = topRow
    const bottomPadding = (lines.length - 1) - bottomRow
    const leftPadding = topBorder.indexOf("╭")
    const rightPadding = 79 - topBorder.lastIndexOf("╮")

    expect(topPadding).toBeGreaterThan(0)
    expect(bottomPadding).toBeGreaterThan(0)
    expect(Math.abs(topPadding - bottomPadding)).toBeLessThanOrEqual(1)
    expect(leftPadding).toBeGreaterThan(0)
    expect(rightPadding).toBeGreaterThan(0)
    expect(Math.abs(leftPadding - rightPadding)).toBeLessThanOrEqual(1)
    const frame = (instance.lastFrame() ?? "").replace(/\u001B\[[0-9;]*m/g, "")
    expect(frame).toContain("CENTER")
    instance.unmount()
  })
})