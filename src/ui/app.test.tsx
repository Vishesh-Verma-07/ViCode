import React from "react"
import { describe, it, expect } from "bun:test"
import { mkdtempSync, existsSync, readFileSync, readdirSync, rmSync } from "fs"
import { tmpdir } from "os"
import { join } from "path"
import { render } from "ink-testing-library"
import { App, FeedbackLine, extractDiff } from "./app"
import { CommandRegistry } from "../core/command-registry"
import { createHelpCommand } from "../commands/help"
import type { Command, Message } from "../core/types"
import type { Provider, StreamEvent } from "../core/provider"

function until(condition: () => boolean, timeoutMs = 5000): Promise<void> {
  return new Promise((resolve, reject) => {
    const start = Date.now()
    const tick = () => {
      if (condition()) {
        resolve()
        return
      }
      if (Date.now() - start > timeoutMs) {
        reject(new Error("timed out waiting for condition"))
        return
      }
      setTimeout(tick, 10)
    }
    tick()
  })
}

function createStubProvider(capturedMessages: Message[][], events?: StreamEvent[]): Provider {
  return {
    getModelInfo: () => ({ id: "stub-model", name: "stub-model" }),
    async *streamChat(messages) {
      capturedMessages.push([...messages])
      for (const event of events ?? [
        { type: "finish" as const, usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2, cost: 0 } },
      ]) {
        yield event
      }
    },
  }
}

function createTestCommands(): Command[] {
  const registry = new CommandRegistry()
  registry.register(createHelpCommand(registry))
  registry.register({
    name: "noop",
    description: "Does nothing",
    execute: async () => "noop done",
  })
  return registry.getAll()
}

describe("extractDiff", () => {
  it("returns result as-is when no diff markers present", () => {
    const result = "File edited successfully: app.ts"
    const { message, diff } = extractDiff(result)
    expect(message).toBe(result)
    expect(diff).toBeNull()
  })

  it("extracts diff from tool result with markers", () => {
    const diffContent = "--- a/app.ts\n+++ b/app.ts\n@@ -1 +1 @@\n-old\n+new"
    const result = `File edited successfully: app.ts\n__DIFF_START__\n${diffContent}__DIFF_END__`
    const { message, diff } = extractDiff(result)
    expect(message).toBe("File edited successfully: app.ts")
    expect(diff).toBe(diffContent)
  })

  it("handles result with only diff markers", () => {
    const diffContent = "--- a.txt\n+++ b.txt\n@@ -1 +1 @@\n-old\n+new"
    const result = `__DIFF_START__\n${diffContent}__DIFF_END__`
    const { message, diff } = extractDiff(result)
    expect(message).toBe("")
    expect(diff).toBe(diffContent)
  })

  it("returns null diff when only start marker exists", () => {
    const result = "Some message\n__DIFF_START__\npartial"
    const { message, diff } = extractDiff(result)
    expect(message).toBe(result)
    expect(diff).toBeNull()
  })

  it("returns null diff when only end marker exists", () => {
    const result = "Some message\n__DIFF_END__"
    const { message, diff } = extractDiff(result)
    expect(message).toBe(result)
    expect(diff).toBeNull()
  })

  it("handles multiline diff content", () => {
    const diffContent = `--- a/file.ts
+++ b/file.ts
@@ -1,3 +1,3 @@
 line1
-old line
+new line
 line3`
    const result = `File edited successfully: file.ts\n__DIFF_START__\n${diffContent}__DIFF_END__`
    const { message, diff } = extractDiff(result)
    expect(message).toBe("File edited successfully: file.ts")
    expect(diff).toBe(diffContent)
    expect(diff!.split("\n").length).toBe(7)
  })
})

describe("FeedbackLine", () => {
  it("renders confirmation feedback text", () => {
    const { lastFrame } = render(<FeedbackLine text="Switched model" tone="info" />)
    expect(lastFrame()).toContain("Switched model")
  })

  it("renders error feedback text", () => {
    const { lastFrame } = render(<FeedbackLine text="Something went wrong" tone="error" />)
    expect(lastFrame()).toContain("Something went wrong")
  })

  it("renders multiline help output fully", () => {
    const text = "/help - List available commands\n/noop - Does nothing"
    const { lastFrame } = render(<FeedbackLine text={text} tone="info" />)
    const frame = lastFrame() ?? ""
    expect(frame).toContain("/help - List available commands")
    expect(frame).toContain("/noop - Does nothing")
  })
})

describe("App command interception", () => {
  function setup() {
    const capturedMessages: Message[][] = []
    const provider = createStubProvider(capturedMessages)
    const sessionsDir = mkdtempSync(join(tmpdir(), "vicode-test-"))
    const instance = render(
      <App
        provider={provider}
        tools={[]}
        systemPrompt=""
        context={{ projectPath: join(sessionsDir, "project") }}
        sessionsDir={sessionsDir}
        commands={createTestCommands()}
      />,
    )

    async function typeAndSubmit(text: string): Promise<void> {
      for (const char of text) {
        instance.stdin.write(char)
        await new Promise((resolve) => setTimeout(resolve, 5))
      }
      instance.stdin.write("\r")
    }

    return { ...instance, capturedMessages, sessionsDir, typeAndSubmit }
  }

  it("executes /help without creating a user message or invoking the LLM", async () => {
    const { lastFrame, capturedMessages, typeAndSubmit, unmount } = setup()
    try {
      await until(() => (lastFrame() ?? "").includes("Type your message"))
      await typeAndSubmit("/help")
      await until(() => (lastFrame() ?? "").includes("/help -"))

      expect(lastFrame()).toContain("/noop")
      expect(lastFrame()).not.toContain("You:")
      expect(capturedMessages).toHaveLength(0)
    } finally {
      unmount()
    }
  })

  it("shows an unknown-command error listing available commands", async () => {
    const { lastFrame, capturedMessages, typeAndSubmit, unmount } = setup()
    try {
      await until(() => (lastFrame() ?? "").includes("Type your message"))
      await typeAndSubmit("/frobnicate")
      await until(() => (lastFrame() ?? "").includes("Unknown command"))

      const frame = lastFrame() ?? ""
      expect(frame).toContain("/frobnicate")
      expect(frame).toContain("/help")
      expect(frame).toContain("/noop")
      expect(frame).not.toContain("You:")
      expect(capturedMessages).toHaveLength(0)
    } finally {
      unmount()
    }
  })

  it("renders command feedback as display-only entries excluded from provider messages and saved session JSON", async () => {
    const { stdin, lastFrame, capturedMessages, sessionsDir, typeAndSubmit, unmount } = setup()
    try {
      await until(() => (lastFrame() ?? "").includes("Type your message"))

      await typeAndSubmit("/noop")
      await until(() => (lastFrame() ?? "").includes("noop done"))

      await typeAndSubmit("hello world")
      await until(() => capturedMessages.length > 0)
      await until(() => (lastFrame() ?? "").includes("hello world"))

      const frame = lastFrame() ?? ""
      expect(frame).toContain("noop done")
      expect(frame).toContain("hello world")

      for (const messages of capturedMessages) {
        const serialized = JSON.stringify(messages)
        expect(serialized).not.toContain("noop done")
        expect(serialized).not.toContain("/noop")
      }

      let sessionRaw = ""
      await until(() => {
        if (!existsSync(sessionsDir)) return false
        const files = readdirSync(sessionsDir).filter((f) => f.endsWith(".json"))
        if (files.length === 0) return false
        sessionRaw = readFileSync(join(sessionsDir, files[0]!), "utf-8")
        return sessionRaw.includes("hello world")
      })
      expect(sessionRaw).not.toContain("noop done")
      expect(sessionRaw).not.toContain("/noop")
      void stdin
    } finally {
      unmount()
      rmSync(sessionsDir, { recursive: true, force: true })
    }
  })
})
