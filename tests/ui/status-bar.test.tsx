import React from "react"
import { describe, it, expect } from "bun:test"
import { renderToString } from "ink"
import { StatusBar } from "@/ui/status-bar"

const USAGE = { inputTokens: 1, outputTokens: 2, totalTokens: 30_000, cost: 0.42 }
const LONG_ROUTE = "openrouter/nvidia/nemotron-3-ultra-550b-a55b:free"

function rows(route: string, columns: number): string[] {
  const frame = renderToString(
    <StatusBar usage={USAGE} route={route} status={{ kind: "working", toolName: "search" }} />,
    { columns },
  )
  return frame
    .split("\n")
    .map((line) => line.replace(/\u001B\[[0-9;]*m/g, ""))
    .filter((line) => line.trim() !== "")
}

describe("StatusBar route", () => {
  it("names the Provider with the Model, so the bar says which route is live", () => {
    const line = rows("opencode-go/claude-opus-5-5", 120)[0] ?? ""
    expect(line).toContain("opencode-go/claude-opus-5-5")
  })

  it("cuts a long route at the end rather than splitting it across rows", () => {
  const rendered = rows(LONG_ROUTE, 80)
  expect(rendered[0]).toContain("openrouter/")
  expect(rendered.slice(1).join("\n")).not.toContain("nemotron")
  })

  it("shows the whole route when the terminal has room for it", () => {
    expect(rows(LONG_ROUTE, 120)[0]).toContain(LONG_ROUTE)
  })
})