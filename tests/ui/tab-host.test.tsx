import React from "react"
import { describe, it, expect } from "bun:test"
import { render } from "ink-testing-library"
import { Box, Text } from "ink"
import { TabHost, type TabSummary } from "@/ui/tab-host"
import type { Provider } from "@/core/provider"
import { createSession } from "@/core/session"
import type { Message } from "@/core/types"
import type { ClipboardResult } from "@/core/clipboard"

function createStubProvider(): Provider {
  return {
    getModelInfo: () => ({ id: "stub-model", name: "stub-model", contextLength: null }),
    async listModels() {
      return []
    },
    async *streamChat() {
      yield { type: "finish" as const, usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0, cost: 0 } }
    },
  }
}

/** A provider that streams one delta, holds the Turn open, then finishes. */
function createSlowProvider(holdMs: number): Provider {
  return {
    getModelInfo: () => ({ id: "stub-model", name: "stub-model", contextLength: null }),
    async listModels() {
      return []
    },
    async *streamChat() {
      yield { type: "text-delta" as const, text: "ok" }
      await new Promise((resolve) => setTimeout(resolve, holdMs))
      yield { type: "finish" as const, usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0, cost: 0 } }
    },
  }
}

function until(condition: () => boolean, timeoutMs = 5000): Promise<void> {
  return new Promise((resolve, reject) => {
    const start = Date.now()
    const tick = () => {
      if (condition()) {
        resolve()
        return
      }
      if (Date.now() - start > timeoutMs) {
        reject(new Error("timed out waiting for the rendered frame"))
        return
      }
      setTimeout(tick, 10)
    }
    tick()
  })
}

type Instance = ReturnType<typeof render>

function frameText(instance: Instance): string {
  return (instance.lastFrame() ?? "").replace(/\u001B\[[0-9;]*m/g, "")
}

async function type(instance: Instance, text: string): Promise<void> {
  for (const char of text) {
    instance.stdin.write(char)
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
}

function baseProps() {
  return {
    provider: createStubProvider(),
    tools: [],
    context: { projectPath: "/tmp/tab-host-test" },
    keyFor: () => "test-key",
    width: 100,
    height: 30,
    view: "chat" as const,
    onEnterChat: () => {},
    onEnterHome: () => {},
  }
}

describe("TabHost", () => {
  it("keeps each conversation's draft while only one host is active", async () => {
    const props = baseProps()
    const tree = (activeHost: "a" | "b") => (
      <Box flexDirection="column">
        <TabHost {...props} active={activeHost === "a"} />
        <TabHost {...props} active={activeHost === "b"} />
      </Box>
    )

    const instance = render(tree("a"))
    try {
      await until(() => frameText(instance).includes("Type your message..."))

      await type(instance, "alpha")
      await until(() => frameText(instance).includes("alpha"))

      instance.rerender(tree("b"))
      await until(() => frameText(instance).includes("Type your message...") && !frameText(instance).includes("alpha"))

      await type(instance, "beta")
      await until(() => frameText(instance).includes("beta"))

      instance.rerender(tree("a"))
      await until(() => frameText(instance).includes("alpha"))
      expect(frameText(instance)).not.toContain("beta")

      instance.rerender(tree("b"))
      await until(() => frameText(instance).includes("beta"))
      expect(frameText(instance)).not.toContain("alpha")
    } finally {
      instance.unmount()
    }
  }, 15000)

  it("renders nothing while inactive", async () => {
    const instance = render(<TabHost {...baseProps()} active={false} />)
    try {
      await new Promise((resolve) => setTimeout(resolve, 50))
      expect(frameText(instance)).not.toContain("Type your message...")
    } finally {
      instance.unmount()
    }
  })

  it("renders the welcome screen when the conversation is at home", async () => {
    const instance = render(<TabHost {...baseProps()} active view="home" />)
    try {
      await until(() => frameText(instance).includes("AI-Powered Coding Assistant"))
      expect(frameText(instance)).toContain("Ask anything or select an option")
      expect(frameText(instance)).not.toContain("Type your message...")
    } finally {
      instance.unmount()
    }
  })

  it("reports its streaming state upward while a Turn runs", async () => {
    const summaries: TabSummary[] = []
    const instance = render(
      <TabHost
        {...baseProps()}
        provider={createSlowProvider(200)}
        active
        onSummaryChange={(summary) => summaries.push(summary)}
      />,
    )
    try {
      await until(() => frameText(instance).includes("Type your message..."))

      await type(instance, "hello")
      instance.stdin.write("\r")

      await until(() => summaries.some((summary) => summary.streaming))
      expect(summaries.at(-1)).toMatchObject({ needsApproval: false, errored: false })

      await until(() => summaries.length > 0 && !summaries.at(-1)!.streaming)
      expect(summaries.at(-1)).toEqual({
        streaming: false,
        needsApproval: false,
        errored: false,
        blocking: false,
      })
    } finally {
      instance.unmount()
    }
  }, 15000)

  it("does not report again when only the callback identity changes", async () => {
    let reports = 0
    const instance = render(
      <TabHost
        {...baseProps()}
        active
        onSummaryChange={() => {
          reports++
        }}
      />,
    )
    try {
      await until(() => frameText(instance).includes("Type your message..."))
      await new Promise((resolve) => setTimeout(resolve, 50))
      const settled = reports

      instance.rerender(
        <TabHost
          {...baseProps()}
          active
          onSummaryChange={() => {
            reports++
          }}
        />,
      )
      await new Promise((resolve) => setTimeout(resolve, 50))

      expect(reports).toBe(settled)
    } finally {
      instance.unmount()
    }
  })
})

describe("TabHost Select Mode", () => {
  const CTRL_S = "\u0013"
  const UP = "\u001B[A"
  const ENTER = "\r"
  const ESCAPE = "\u001B"

  function seedSession(): ReturnType<typeof createSession> {
    const messages: Message[] = [
      {
        id: "u1",
        role: "user",
        content: [{ type: "text", text: "first question" }],
        timestamp: 1,
      },
      {
        id: "a1",
        role: "assistant",
        content: [{ type: "text", text: "first answer" }],
        timestamp: 2,
      },
      {
        id: "u2",
        role: "user",
        content: [{ type: "text", text: "second question" }],
        timestamp: 3,
      },
      {
        id: "a2",
        role: "assistant",
        content: [{ type: "text", text: "second answer" }],
        timestamp: 4,
      },
    ]
    return createSession({ model: "openrouter/stub-model", messages })
  }

  function longSession(): ReturnType<typeof createSession> {
    const messages: Message[] = Array.from({ length: 40 }, (_, index) => ({
      id: `m${index}`,
      role: index % 2 === 0 ? "user" : "assistant",
      content: [{ type: "text", text: `line ${index}` }],
      timestamp: index,
    }))
    return createSession({ model: "openrouter/stub-model", messages })
  }

  function setup(
    copyText: (text: string) => Promise<ClipboardResult>,
    session: ReturnType<typeof createSession> = seedSession(),
  ) {
    const instance = render(
      <TabHost
        {...baseProps()}
        active
        initialSession={session}
        copyText={copyText}
      />,
    )
    async function press(key: string): Promise<void> {
      instance.stdin.write(key)
      await new Promise((resolve) => setTimeout(resolve, 25))
    }
    /** The 1-based screen row holding a piece of transcript text. */
    function rowOf(text: string): number {
      const index = frameText(instance).split("\n").findIndex((line) => line.includes(text))
      if (index < 0) throw new Error(`"${text}" is not on screen`)
      return index + 1
    }
    async function click(row: number, column = 5): Promise<void> {
      instance.stdin.write(`\u001B[<0;${column};${row}M`)
      instance.stdin.write(`\u001B[<0;${column};${row}m`)
      await new Promise((resolve) => setTimeout(resolve, 25))
    }
    async function drag(fromRow: number, toRow: number, column = 5): Promise<void> {
      instance.stdin.write(`\u001B[<0;${column};${fromRow}M`)
      instance.stdin.write(`\u001B[<32;${column};${toRow}M`)
      instance.stdin.write(`\u001B[<0;${column};${toRow}m`)
      await new Promise((resolve) => setTimeout(resolve, 25))
    }
    return { instance, press, rowOf, click, drag }
  }

  it("enters Select Mode on Ctrl+S at the newest message", async () => {
    const { instance, press } = setup(async () => ({ kind: "failed", reason: "not used" }))
    try {
      await until(() => frameText(instance).includes("Type your message..."))
      await press(CTRL_S)

      await until(() => frameText(instance).includes("Selecting messages..."))
      expect(frameText(instance)).toContain("Select message 4/4")
      expect(frameText(instance)).toContain("Space select")
    } finally {
      instance.unmount()
    }
  })

  it("moves the highlight with the arrow keys", async () => {
    const copied: string[] = []
    const { instance, press } = setup(async (text) => {
      copied.push(text)
      return { kind: "copied", via: "command", command: "stub" }
    })
    try {
      await until(() => frameText(instance).includes("Type your message..."))
      await press(CTRL_S)
      await press(UP)
      await press(UP)

      await until(() => frameText(instance).includes("Select message 2/4"))
      await press(ENTER)

      await until(() => copied.length > 0)
      expect(copied[0]).toBe("first answer")
    } finally {
      instance.unmount()
    }
  })

  it("copies the marked messages in transcript order", async () => {
    const copied: string[] = []
    const { instance, press } = setup(async (text) => {
      copied.push(text)
      return { kind: "copied", via: "command", command: "stub" }
    })
    try {
      await until(() => frameText(instance).includes("Type your message..."))
      await press(CTRL_S)
      await press(" ")
      await press(UP)
      await press(" ")

      await until(() => frameText(instance).includes("2 selected"))
      await press(ENTER)

      await until(() => copied.length > 0)
      expect(copied[0]).toBe("second question\n\nsecond answer")
      await until(() => frameText(instance).includes("Copied 2 messages to clipboard."))
      expect(frameText(instance)).not.toContain("Selecting messages...")
    } finally {
      instance.unmount()
    }
  })

  it("also copies on Ctrl+C while Select Mode owns the keyboard", async () => {
    const copied: string[] = []
    const { instance, press } = setup(async (text) => {
      copied.push(text)
      return { kind: "copied", via: "command", command: "stub" }
    })
    try {
      await until(() => frameText(instance).includes("Type your message..."))
      await press(CTRL_S)
      await press(UP)
      await press("\u0003")

      await until(() => copied.length > 0)
      expect(copied[0]).toBe("second question")
      await until(() => frameText(instance).includes("Copied message to clipboard."))
    } finally {
      instance.unmount()
    }
  })

  it("stays open and reports a failed copy", async () => {
    const { instance, press } = setup(async () => ({
      kind: "failed",
      reason: "clipboard is offline",
    }))
    try {
      await until(() => frameText(instance).includes("Type your message..."))
      await press(CTRL_S)
      await press(ENTER)

      await until(() => frameText(instance).includes("Could not copy: clipboard is offline"))
      expect(frameText(instance)).toContain("Selecting messages...")
    } finally {
      instance.unmount()
    }
  })

  it("leaves Select Mode on Escape without copying", async () => {
    let copies = 0
    const { instance, press } = setup(async () => {
      copies++
      return { kind: "copied", via: "command", command: "stub" }
    })
    try {
      await until(() => frameText(instance).includes("Type your message..."))
      await press(CTRL_S)
      await until(() => frameText(instance).includes("Selecting messages..."))
      await press(ESCAPE)

      await until(() => frameText(instance).includes("Type your message..."))
      expect(frameText(instance)).not.toContain("Selecting messages...")
      expect(copies).toBe(0)
    } finally {
      instance.unmount()
    }
  })

  it("starts Select Mode on the message clicked", async () => {
    const { instance, click, rowOf } = setup(async () => ({
      kind: "copied",
      via: "command",
      command: "stub",
    }))
    try {
      await until(() => frameText(instance).includes("Type your message..."))
      await click(rowOf("first answer"))

      await until(() => frameText(instance).includes("Selecting messages..."))
      expect(frameText(instance)).toContain("Select message 2/4")
    } finally {
      instance.unmount()
    }
  })

  it("counts the chrome rows above the host when mapping a click", async () => {
    const instance = render(
      <Box flexDirection="column">
        <Text>chrome row one</Text>
        <Text>chrome row two</Text>
        <TabHost
          {...baseProps()}
          active
          initialSession={seedSession()}
          screenTop={3}
          copyText={async () => ({ kind: "copied", via: "command", command: "stub" })}
        />
      </Box>,
    )
    try {
      await until(() => frameText(instance).includes("Type your message..."))
      const row = frameText(instance)
        .split("\n")
        .findIndex((line) => line.includes("first answer")) + 1
      expect(row).toBeGreaterThan(3)

      instance.stdin.write(`\u001B[<0;5;${row}M`)
      instance.stdin.write(`\u001B[<0;5;${row}m`)

      await until(() => frameText(instance).includes("Selecting messages..."))
      expect(frameText(instance)).toContain("Select message 2/4")
    } finally {
      instance.unmount()
    }
  })

  it("maps a click while the transcript is scrolled up", async () => {
    const { instance } = setup(
      async () => ({ kind: "failed", reason: "not used" }),
      longSession(),
    )
    try {
      await until(() => frameText(instance).includes("Type your message..."))
      for (let notch = 0; notch < 9; notch++) {
        instance.stdin.write("\u001B[<64;5;5M")
        await new Promise((resolve) => setTimeout(resolve, 20))
      }
      await until(() => frameText(instance).includes("End to return"))

      const lines = frameText(instance).split("\n")
      const hint = lines.findIndex((line) => line.includes("End to return"))
      let row = -1
      let messageIndex = -1
      for (let index = hint + 1; index < lines.length; index++) {
        const match = /line (\d+)/.exec(lines[index] ?? "")
        if (!match) continue
        row = index + 1
        messageIndex = Number(match[1])
        break
      }
      expect(messageIndex).toBeGreaterThanOrEqual(0)

      instance.stdin.write(`\u001B[<0;5;${row}M`)
      instance.stdin.write(`\u001B[<0;5;${row}m`)

      await until(() =>
        frameText(instance).includes(`Select message ${messageIndex + 1}/40`),
      )
    } finally {
      instance.unmount()
    }
  })

  it("marks the messages a drag crosses and copies them on Enter", async () => {
    const copied: string[] = []
    const { instance, press, drag, rowOf } = setup(async (text) => {
      copied.push(text)
      return { kind: "copied", via: "command", command: "stub" }
    })
    try {
      await until(() => frameText(instance).includes("Type your message..."))
      await drag(rowOf("first answer"), rowOf("second question"))

      await until(() => frameText(instance).includes("2 selected"))
      expect(frameText(instance)).toContain("Select message 3/4")
      await press(ENTER)

      await until(() => copied.length > 0)
      expect(copied[0]).toBe("first answer\n\nsecond question")
    } finally {
      instance.unmount()
    }
  })

  it("walks the Select Mode highlight with the wheel", async () => {
    const { instance, press } = setup(async () => ({
      kind: "copied",
      via: "command",
      command: "stub",
    }))
    try {
      await until(() => frameText(instance).includes("Type your message..."))
      await press(CTRL_S)
      await until(() => frameText(instance).includes("Select message 4/4"))

      instance.stdin.write("\u001B[<64;5;10M")
      await until(() => frameText(instance).includes("Select message 3/4"))
    } finally {
      instance.unmount()
    }
  })
})
