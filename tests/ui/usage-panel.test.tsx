import React from "react"
import { describe, it, expect } from "bun:test"
import { Box } from "ink"
import { renderToString } from "ink"
import { homedir } from "os"
import { join } from "path"
import { UsagePanel } from "@/ui/usage-panel"
import { COLORS } from "@/ui/theme"
import { ansiCode } from "@/ui/ansi-test"

const BASE = {
  model: "stub-model",
  contextLength: null,
  usage: { inputTokens: 1, outputTokens: 2, totalTokens: 3, cost: 0 },
  turns: 1,
  status: { kind: "idle" as const },
}

function clean(s: string): string {
  return s.replace(/\u001B\[[0-9;]*m/g, "")
}

function renderPanel(projectRoot: string | undefined, width: number): string {
  const props = projectRoot === undefined ? BASE : { ...BASE, projectRoot }
  return renderToString(<UsagePanel width={width} {...props} />, { columns: width })
}

function renderPinned(projectRoot: string, width: number, height: number): string {
  return renderToString(
    <Box height={height} flexDirection="column">
      <UsagePanel width={width} {...BASE} projectRoot={projectRoot} />
    </Box>,
    { columns: width },
  )
}

function linesOf(frame: string): string[] {
  return frame.split("\n").map(clean)
}

function outsideHomePath(): string {
  const home = homedir().replace(/\\/g, "/").replace(/\/+$/, "")
  const candidates = [
    "/definitely-outside-home-vicode-probe-xyz123/project",
    "C:/definitely-outside-home-vicode-probe-xyz123/project",
  ]
  for (const candidate of candidates) {
    if (candidate !== home && !candidate.startsWith(`${home}/`)) {
      return candidate
    }
  }
  return candidates[0]!
}

describe("UsagePanel project root path", () => {
  it("shows the path alone with no label and no icon", () => {
    const projectRoot = join(homedir(), "vicode-probe-lone")
    const frame = renderPanel(projectRoot, 80)
    const lines = linesOf(frame)
    const idx = lines.findIndex((l) => l.includes("vicode-probe-lone"))
    expect(idx).toBeGreaterThanOrEqual(0)
    expect(lines[idx]!.trim()).toBe("~/vicode-probe-lone")
  })

  it("pins the path to the panel's last rows with the exit hint beneath it, as the height changes", () => {
    const projectRoot = join(homedir(), "vicode-probe-pin")
    for (const height of [18, 24]) {
      const frame = renderPinned(projectRoot, 30, height)
      const lines = linesOf(frame)
      expect(lines.length).toBe(height)
      const hintIdx = lines.findIndex((l) => l.includes("Ctrl+C to exit"))
      expect(hintIdx).toBe(lines.length - 1)
      const pathIdx = lines.findIndex((l) => l.includes("vicode-probe-pin"))
      expect(pathIdx).toBe(hintIdx - 1)
      const turnsIdx = lines.findIndex((l) => l.includes("Turns:"))
      expect(turnsIdx).toBeGreaterThanOrEqual(0)
      expect(pathIdx - turnsIdx).toBeGreaterThan(1)
    }
  })

  it("styles the path in the muted token, distinct from the italic exit hint", () => {
    const projectRoot = join(homedir(), "vicode-probe-tone")
    const frame = renderPanel(projectRoot, 60)
    const rawLines = frame.split("\n")
    const pathRaw = rawLines.find((l) => clean(l).includes("vicode-probe-tone")) ?? ""
    const hintRaw = rawLines.find((l) => clean(l).includes("Ctrl+C to exit")) ?? ""
    expect(pathRaw).toContain(ansiCode(COLORS.muted))
    expect(pathRaw).not.toContain("\u001B[3m")
    expect(hintRaw).toContain("\u001B[3m")
  })

  it("shortens a project root under home to a leading ~", () => {
    const projectRoot = join(homedir(), "vicode-probe-short")
    const frame = renderPanel(projectRoot, 80)
    const cleaned = clean(frame)
    expect(cleaned).toContain("~/vicode-probe-short")
    expect(cleaned).not.toContain(join(homedir(), "vicode-probe-short"))
  })

  it("collapses a project root that is home to a bare ~", () => {
    const frame = renderPanel(homedir(), 80)
    const lines = linesOf(frame)
    const hintIdx = lines.findIndex((l) => l.includes("Ctrl+C to exit"))
    expect(lines[hintIdx - 1]!.trim()).toBe("~")
  })

  it("renders a project root outside home raw with forward slashes", () => {
    const outside = outsideHomePath()
    const frame = renderPanel(outside, 80)
    const lines = linesOf(frame)
    const pathLine = lines.find((l) => l.includes("definitely-outside-home-vicode-probe-xyz123")) ?? ""
    expect(pathLine).toContain(outside)
    expect(pathLine).not.toContain("~")
    expect(pathLine).not.toContain("\\")
  })

  it("truncates a long path from the left, keeping the trailing directory visible on one row", () => {
    const projectRoot = join(
      homedir(),
      "early-segment-xyz123",
      "a",
      "very",
      "long",
      "chain",
      "of",
      "directories",
      "trail-dir-xyz123",
    )
    const frame = renderPanel(projectRoot, 30)
    const lines = linesOf(frame)
    const matches = lines.filter((l) => l.includes("trail-dir-xyz123"))
    expect(matches).toHaveLength(1)
    expect(clean(frame)).not.toContain("early-segment-xyz123")
  })

  it("renders nothing when no project root is supplied", () => {
    const frame = renderPanel(undefined, 60)
    const lines = linesOf(frame)
    expect(clean(frame)).toContain("Ctrl+C to exit")
    expect(clean(frame)).not.toContain("vicode-probe-absent-xyz123")
    const hintIdx = lines.findIndex((l) => l.includes("Ctrl+C to exit"))
    expect(hintIdx).toBe(lines.length - 1)
    expect(lines[hintIdx - 1]).not.toContain("~")
  })
})

describe("UsagePanel unknown figures", () => {
  function rowValue(frame: string, label: string): string {
    const row = linesOf(frame).find((l) => l.includes(`${label}:`))
    if (!row) throw new Error(`no ${label} row in:\n${frame}`)
    return row.slice(row.indexOf(`${label}:`) + label.length + 1).trim()
  }

  it("reads an unpriced Model's cost as a dash, not as $0.00", () => {
    const frame = renderToString(
      <UsagePanel
        width={60}
        {...BASE}
        usage={{ ...BASE.usage, totalTokens: 3000, cost: null }}
      />,
      { columns: 60 },
    )
    expect(rowValue(frame, "Cost")).toBe("—")
  })

  it("still reads a genuinely free Model's cost as $0.00", () => {
    const frame = renderToString(<UsagePanel width={60} {...BASE} />, { columns: 60 })
    expect(rowValue(frame, "Cost")).toBe("$0.00")
  })

  it("shows the Context row as a dash rather than hiding it when the window is unmeasured", () => {
    const frame = renderToString(<UsagePanel width={60} {...BASE} />, { columns: 60 })
    expect(rowValue(frame, "Context")).toBe("—")
  })

  it("shows the measured window and its share of the context when known", () => {
    const frame = renderToString(
      <UsagePanel
        width={60}
        {...BASE}
        contextLength={200_000}
        usage={{ ...BASE.usage, totalTokens: 100_000, cost: 0.42 }}
      />,
      { columns: 60 },
    )
    expect(rowValue(frame, "Context")).toBe("200.0k (50.0%)")
    expect(rowValue(frame, "Cost")).toBe("$0.420")
  })
})
