import React from "react"
import { describe, it, expect } from "bun:test"
import { render } from "ink-testing-library"
import { TabBar, truncateTabTitle } from "@/ui/tab-bar"

function frameText(lastFrame: () => string | undefined): string {
  return (lastFrame() ?? "").replace(/\u001B\[[0-9;]*m/g, "")
}

function frameLines(lastFrame: () => string | undefined): string[] {
  return frameText(lastFrame)
    .split("\n")
    .filter((line) => line.trim().length > 0)
}

describe("Tab Bar", () => {
  it("renders every title in order with + after the last Tab", () => {
    const instance = render(
      <TabBar
        width={80}
        tabs={[
          { id: "tab-1", title: "alpha", active: false },
          { id: "tab-2", title: "beta", active: true },
        ]}
      />,
    )
    try {
      const line = frameText(instance.lastFrame)
      expect(line.indexOf("alpha")).toBeGreaterThanOrEqual(0)
      expect(line.indexOf("alpha")).toBeLessThan(line.indexOf("beta"))
      expect(line.indexOf("beta")).toBeLessThan(line.indexOf("+"))
    } finally {
      instance.unmount()
    }
  })

  it("stays one row high", () => {
    const instance = render(
      <TabBar
        width={60}
        tabs={[
          { id: "tab-1", title: "alpha", active: true },
          { id: "tab-2", title: "beta", active: false },
        ]}
      />,
    )
    try {
      expect(frameText(instance.lastFrame).split("\n")).toHaveLength(1)
    } finally {
      instance.unmount()
    }
  })

  it("truncates a long title rather than wrapping", () => {
    const long = "a title far too long to fit in one Tab"
    const instance = render(
      <TabBar width={40} tabs={[{ id: "tab-1", title: long, active: true }]} />,
    )
    try {
      const lines = frameLines(instance.lastFrame)
      expect(lines).toHaveLength(1)
      expect(lines[0]).toContain("…")
      expect(lines[0]).not.toContain(long)
      expect(lines[0]).toContain("+")
    } finally {
      instance.unmount()
    }
  })
})

describe("truncateTabTitle", () => {
  it("leaves a title that fits alone", () => {
    expect(truncateTabTitle("alpha", 5)).toBe("alpha")
    expect(truncateTabTitle("alpha", 10)).toBe("alpha")
  })

  it("cuts and marks the title that does not fit", () => {
    expect(truncateTabTitle("release prep", 8)).toBe("release…")
    expect(truncateTabTitle("alpha", 1)).toBe("…")
    expect(truncateTabTitle("alpha", 0)).toBe("")
  })
})
