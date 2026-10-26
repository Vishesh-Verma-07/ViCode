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

  it("puts × on the active Tab and on no other", () => {
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
      expect((line.match(/×/g) ?? []).length).toBe(1)
      expect(line).toContain("beta ×")
      expect(line.slice(0, line.indexOf("beta"))).not.toContain("×")
    } finally {
      instance.unmount()
    }
  })

  it("keeps × when the active title is cut to fit", () => {
    const instance = render(
      <TabBar width={20} tabs={[{ id: "tab-1", title: "a title far too long", active: true }]} />,
    )
    try {
      const lines = frameLines(instance.lastFrame)
      expect(lines).toHaveLength(1)
      expect(lines[0]).toContain("…")
      expect(lines[0]).toContain("×")
      expect(lines[0]).toContain("+")
    } finally {
      instance.unmount()
    }
  })

  it("does not shift the Bar when focus moves between Tabs", () => {
    const renderWith = (activeId: string) => {
      const instance = render(
        <TabBar
          width={60}
          tabs={[
            { id: "tab-1", title: "alpha", active: activeId === "tab-1" },
            { id: "tab-2", title: "beta", active: activeId === "tab-2" },
          ]}
        />,
      )
      try {
        return frameText(instance.lastFrame)
      } finally {
        instance.unmount()
      }
    }

    const first = renderWith("tab-1")
    const second = renderWith("tab-2")
    expect(first.indexOf("beta")).toBe(second.indexOf("beta"))
    expect(first.indexOf("+")).toBe(second.indexOf("+"))
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

  it("scrolls a crowded strip to the active Tab and keeps + beside the last one", () => {
    const tabs = Array.from({ length: 8 }, (_, index) => ({
      id: `tab-${index}`,
      title: `tab ${index + 1}`,
      active: index === 7,
    }))
    const instance = render(<TabBar width={60} tabs={tabs} />)
    try {
      const lines = frameLines(instance.lastFrame)
      expect(lines).toHaveLength(1)
      const line = lines[0] ?? ""
      expect(line).not.toContain("tab 1")
      expect(line).not.toContain("tab 4")
      expect(line).toContain("tab 5")
      expect(line).toContain("tab 8 ×")
      expect(line.indexOf("+")).toBeGreaterThan(line.indexOf("tab 8"))
    } finally {
      instance.unmount()
    }
  })

  it("keeps usable Tabs in a narrow strip rather than a row of ellipses", () => {
    const instance = render(
      <TabBar
        width={20}
        tabs={[
          { id: "tab-1", title: "alpha", active: false },
          { id: "tab-2", title: "beta", active: false },
          { id: "tab-3", title: "gamma", active: true },
        ]}
      />,
    )
    try {
      const lines = frameLines(instance.lastFrame)
      expect(lines).toHaveLength(1)
      expect(lines[0]).toContain("gamma ×")
      expect(lines[0]).toContain("+")
      expect(lines[0]).not.toContain("…")
    } finally {
      instance.unmount()
    }
  })

  it("stays one row with more Tabs than the window can hold", () => {
    const tabs = Array.from({ length: 20 }, (_, index) => ({
      id: `tab-${index}`,
      title: `chat ${index + 1}`,
      active: index === 12,
    }))
    const instance = render(<TabBar width={60} tabs={tabs} />)
    try {
      const lines = frameLines(instance.lastFrame)
      expect(lines).toHaveLength(1)
      expect(lines[0]).toContain("chat 13 ×")
      expect(lines[0]).toContain("+")
      expect(lines[0]).not.toContain("chat 1 ")
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
