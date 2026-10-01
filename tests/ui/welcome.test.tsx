import React from "react"
import { describe, it, expect } from "bun:test"
import { Box, renderToString } from "ink"
import { render } from "ink-testing-library"
import { homedir } from "os"
import { join } from "path"
import { WelcomeScreen } from "@/ui/welcome"
import { App } from "@/ui/app"
import { COLORS } from "@/ui/theme"
import { findMode } from "@/core/modes"
import { ansiCode } from "@/ui/ansi-test"
import type { Provider } from "@/core/provider"

const provider: Provider = {
  getModelInfo: () => ({ id: "stub-model", name: "stub-model" }),
  async listModels() {
    return []
  },
  async *streamChat() {},
}

const LEFT = "\u001B[D"

async function sendKeys(instance: { stdin: { write: (s: string) => void } }, keys: string[]): Promise<void> {
  for (const key of keys) {
    instance.stdin.write(key)
    await new Promise((resolve) => setTimeout(resolve, 15))
  }
}

describe("WelcomeScreen cursor-aware editing", () => {
  it("moves the cursor left and inserts at it before sending", async () => {
    const sent: string[] = []
    const instance = render(
      <WelcomeScreen provider={provider} onNewChat={() => {}} onSendFirstMessage={(value) => sent.push(value)} />,
    )
    try {
      await sendKeys(instance, ["h", "e", "l", "l", "o", LEFT, LEFT, LEFT, "X", "\r"])
      expect(sent.at(-1)).toBe("heXllo")
    } finally {
      instance.unmount()
    }
  })
})

describe("WelcomeScreen banner colorization", () => {
  it("renders the centered ViCode banner colorized with the primary accent", () => {
    const frame = renderToString(
      <WelcomeScreen provider={provider} onNewChat={() => {}} onSendFirstMessage={() => {}} />,
      { columns: 100 },
    )

    const bannerLine = "  ██╗   ██╗██╗███████╗███████╗███████╗███████╗"
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

describe("WelcomeScreen mode indicator", () => {
  it("shows the Mode Switcher inside the first-message box, not beside the model line", () => {
    const frame = renderToString(
      <WelcomeScreen
        provider={provider}
        onNewChat={() => {}}
        onSendFirstMessage={() => {}}
        mode={findMode("build")!}
      />,
      { columns: 100 },
    )
    const clean = (s: string) => s.replace(/\u001B\[[0-9;]*m/g, "")
    const modelLine = frame.split("\n").map(clean).find((l) => l.includes("Model:")) ?? ""
    expect(modelLine).not.toContain("[Build]")

    const cleaned = clean(frame)
    expect(cleaned.replace(/[[\]]/g, "")).toContain("Build Discuss Plan")
    expect(cleaned).toContain("[Build]")
  })
})

const HINT_TEXT = "↑↓ Navigate  •  Enter Select  •  Type to start chatting  •  Ctrl+C Exit"

function cleanFrame(frame: string): string {
  return frame.replace(/\u001B\[[0-9;]*m/g, "")
}

function frameLines(frame: string): string[] {
  return cleanFrame(frame).split("\n")
}

function renderWelcome(projectRoot: string | undefined, width: number, height: number): string {
  const props =
    projectRoot === undefined
      ? { provider, onNewChat: () => {}, onSendFirstMessage: (_msg: string) => {} }
      : { provider, onNewChat: () => {}, onSendFirstMessage: (_msg: string) => {}, projectRoot }
  return renderToString(
    <Box height={height} flexDirection="column">
      <WelcomeScreen {...props} />
    </Box>,
    { columns: width },
  )
}

function leadingSpaces(line: string): number {
  return line.length - line.trimStart().length
}

describe("WelcomeScreen project root footer", () => {
  it("shares one footer at the bottom with the path above the hint, path at left, banner centred, menu and input undisturbed", () => {
    const projectRoot = join(homedir(), "vicode-probe-welcome")
    const frame = renderWelcome(projectRoot, 100, 30)
    const lines = frameLines(frame)
    expect(lines.length).toBe(30)

    const hintIdx = lines.findIndex((l) => l.includes("Type to start chatting"))
    expect(hintIdx).toBe(lines.length - 1)
    expect(lines[hintIdx]).toContain(HINT_TEXT)

    const pathIdx = lines.findIndex((l) => l.includes("vicode-probe-welcome"))
    expect(pathIdx).toBeGreaterThanOrEqual(0)
    expect(pathIdx).toBe(hintIdx - 1)
    expect(lines[pathIdx]!.trim()).toBe("~/vicode-probe-welcome")

    expect(leadingSpaces(lines[pathIdx]!)).toBeLessThanOrEqual(3)

    const bannerLine = lines.find((l) => l.includes("██╗   ██╗")) ?? ""
    expect(leadingSpaces(bannerLine)).toBeGreaterThan(2)
    expect(leadingSpaces(bannerLine)).toBeGreaterThan(leadingSpaces(lines[pathIdx]!))

    const bannerIdx = lines.findIndex((l) => l.includes("██╗   ██╗"))
    const modelIdx = lines.findIndex((l) => l.includes("Model:"))
    const menuIdx = lines.findIndex((l) => l.includes("New Chat"))
    const descIdx = lines.findIndex((l) => l.includes("Start a fresh conversation"))
    const inputIdx = lines.findIndex((l) => l.includes("Ask anything or select an option..."))
    expect(bannerIdx).toBeGreaterThanOrEqual(0)
    expect(modelIdx).toBeGreaterThan(bannerIdx)
    expect(menuIdx).toBeGreaterThan(modelIdx)
    expect(descIdx).toBeGreaterThanOrEqual(menuIdx)
    expect(inputIdx).toBeGreaterThan(menuIdx)
    expect(pathIdx).toBeGreaterThan(inputIdx)

    const rawLines = frame.split("\n")
    const pathRaw = rawLines.find((l) => cleanFrame(l).includes("vicode-probe-welcome")) ?? ""
    expect(pathRaw).toContain(ansiCode(COLORS.muted))
  })

  it("shows the keyboard hint alone when no project root is supplied", () => {
    const frame = renderWelcome(undefined, 100, 30)
    const lines = frameLines(frame)
    const hintIdx = lines.findIndex((l) => l.includes("Type to start chatting"))
    expect(hintIdx).toBe(lines.length - 1)
    expect(lines[hintIdx]).toContain(HINT_TEXT)
    expect(cleanFrame(frame)).not.toContain("vicode-probe-absent-xyz123")
  })

  it("keeps the footer present on a short terminal while centred content gives way", () => {
    const projectRoot = join(homedir(), "vicode-probe-welcome")
    const frame = renderWelcome(projectRoot, 100, 12)
    const lines = frameLines(frame)
    expect(lines.length).toBe(12)
    const hintIdx = lines.findIndex((l) => l.includes("Type to start chatting"))
    expect(hintIdx).toBe(lines.length - 1)
    const pathIdx = lines.findIndex((l) => l.includes("vicode-probe-welcome"))
    expect(pathIdx).toBeGreaterThanOrEqual(0)
    expect(pathIdx).toBeLessThan(hintIdx)
  })
})

describe("Chat window Status Bar scope", () => {
  it("does not carry the Project Root Path", async () => {
    const stubProvider: Provider = {
      getModelInfo: () => ({ id: "stub-model", name: "stub-model" }),
      async listModels() {
        return []
      },
      async *streamChat() {
        yield { type: "finish", usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2, cost: 0 } }
      },
    }
    const instance = render(
      <App
        provider={stubProvider}
        tools={[]}
        context={{ projectPath: "/tmp/scope-pin-xyz123" }}
        keyFor={() => "test-key"}
        initialView="chat"
        commands={[]}
      />,
    )
    try {
      await new Promise((resolve) => setTimeout(resolve, 600))
      const frame = cleanFrame(instance.lastFrame() ?? "")
      expect(frame).toContain("scope-pin-xyz123")
      const lines = frame.split("\n")
      const statusLine = lines.find((l) => l.includes("Tokens:") && l.includes("Cost:") && l.includes("|")) ?? ""
      expect(statusLine).toContain("Tokens:")
      expect(statusLine).not.toContain("scope-pin-xyz123")
    } finally {
      instance.unmount()
    }
  }, 15000)
})