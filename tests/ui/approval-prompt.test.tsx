import React from "react"
import { describe, it, expect } from "bun:test"
import { render } from "ink-testing-library"
import { ApprovalPrompt, approvalOptions } from "@/ui/approval-prompt"

function plain(frame: string | undefined): string {
  return (frame ?? "").replace(/\u001B\[[0-9;]*m/g, "")
}

describe("approvalOptions", () => {
  it("offers approve once, always allow, and reject for bash", () => {
    expect(approvalOptions("bash").map((option) => option.decision)).toEqual([
      "once",
      "always",
      "reject",
    ])
    expect(approvalOptions("bash").map((option) => option.shortcut)).toEqual(["y", "a", "n"])
  })

  it("omits always allow for file tools, whose approval already lasts the Session", () => {
    expect(approvalOptions("write_file").map((option) => option.decision)).toEqual([
      "once",
      "reject",
    ])
  })
})

describe("ApprovalPrompt", () => {
  it("renders the bash command and the three choices", () => {
    const { lastFrame } = render(
      <ApprovalPrompt toolName="bash" args={{ command: "npm test" }} />,
    )
    const frame = plain(lastFrame())
    expect(frame).toContain("npm test")
    expect(frame).toContain("Approve once")
    expect(frame).toContain("Always allow this command")
    expect(frame).toContain("Reject")
  })

  it("marks the selected choice, so arrows visibly move the menu", () => {
    const { lastFrame } = render(
      <ApprovalPrompt toolName="bash" args={{ command: "npm test" }} selected={1} />,
    )
    expect(plain(lastFrame())).toMatch(/❯ \[a\] Always allow this command/)
  })

  it("shows no always-allow row for a file tool", () => {
    const { lastFrame } = render(
      <ApprovalPrompt toolName="write_file" args={{ path: ".env" }} />,
    )
    const frame = plain(lastFrame())
    expect(frame).toContain("Approve once")
    expect(frame).not.toContain("Always allow")
  })
})
