import React from "react"
import { describe, it, expect } from "bun:test"
import { render } from "ink-testing-library"
import { Box } from "ink"
import { TabHost, type TabSummary } from "@/ui/tab-host"
import type { Provider } from "@/core/provider"

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
      expect(summaries.at(-1)).toEqual({ streaming: false, needsApproval: false, errored: false })
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
