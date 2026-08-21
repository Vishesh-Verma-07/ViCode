import React from "react"
import { describe, it, expect } from "bun:test"
import { mkdtempSync, existsSync, readFileSync, readdirSync, rmSync } from "fs"
import { tmpdir } from "os"
import { join } from "path"
import { render } from "ink-testing-library"
import { App, FeedbackLine, extractDiff } from "./app"
import { CommandRegistry } from "../core/command-registry"
import { createHelpCommand } from "../commands/help"
import { createSessionCommand } from "../commands/session"
import { saveSession, type Session } from "../core/session"
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

describe("App session switcher", () => {
  function makeSession(overrides?: Partial<Session>): Session {
    return {
      id: "sess_seed",
      projectPath: "/tmp/test",
      model: "seed-model",
      messages: [],
      createdAt: "2025-01-15T10:30:00.000Z",
      updatedAt: "2025-01-15T10:35:00.000Z",
      totalTokens: 0,
      totalCost: 0,
      ...overrides,
    }
  }

  function makeUserMessage(text: string): Message {
    return {
      id: `msg_${text.replace(/\s+/g, "_")}`,
      role: "user",
      content: [{ type: "text", text }],
      timestamp: Date.now(),
    }
  }

  function setupSwitcher(seedSessions: Session[]) {
    const capturedMessages: Message[][] = []
    const provider = createStubProvider(capturedMessages, [
      { type: "text-delta" as const, text: "ok" },
      { type: "finish" as const, usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2, cost: 0 } },
    ])
    const sessionsDir = mkdtempSync(join(tmpdir(), "vicode-switch-test-"))
    for (const session of seedSessions) {
      saveSession(session, sessionsDir)
    }

    const registry = new CommandRegistry()
    registry.register(createHelpCommand(registry))
    registry.register(createSessionCommand())

    const instance = render(
      <App
        provider={provider}
        tools={[]}
        systemPrompt=""
        context={{ projectPath: join(sessionsDir, "project") }}
        sessionsDir={sessionsDir}
        commands={registry.getAll()}
      />,
    )

    async function typeAndSubmit(text: string): Promise<void> {
      for (const char of text) {
        instance.stdin.write(char)
        await new Promise((resolve) => setTimeout(resolve, 5))
      }
      instance.stdin.write("\r")
    }

    async function pressKey(key: string): Promise<void> {
      instance.stdin.write(key)
      await new Promise((resolve) => setTimeout(resolve, 20))
    }

    return { ...instance, capturedMessages, sessionsDir, typeAndSubmit, pressKey }
  }

  it("lists saved sessions most-recent-first and cancels without changing anything", async () => {
    const older = makeSession({
      id: "sess_old",
      messages: [makeUserMessage("older convo")],
      updatedAt: "2025-01-01T10:00:00.000Z",
    })
    const newer = makeSession({
      id: "sess_new",
      messages: [makeUserMessage("newer convo")],
      updatedAt: "2025-06-01T10:00:00.000Z",
    })
    const { lastFrame, sessionsDir, typeAndSubmit, pressKey, unmount } = setupSwitcher([older, newer])
    try {
      await until(() => (lastFrame() ?? "").includes("Type your message"))
      const targetBefore = readFileSync(join(sessionsDir, "sess_new.json"), "utf-8")

      await typeAndSubmit("/session")
      await until(() => (lastFrame() ?? "").includes("sess_new"))

      const frame = lastFrame() ?? ""
      expect(frame.indexOf("sess_new")).toBeLessThan(frame.indexOf("sess_old"))
      expect(frame).toContain("1 messages")

      await pressKey("\u001B")
      await until(() => !(lastFrame() ?? "").includes("sess_new"))

      expect(lastFrame() ?? "").not.toContain("Switched to session")
      expect(lastFrame() ?? "").not.toContain("newer convo")
      expect(readFileSync(join(sessionsDir, "sess_new.json"), "utf-8")).toBe(targetBefore)
    } finally {
      unmount()
      rmSync(sessionsDir, { recursive: true, force: true })
    }
  })

  it("loads the selected conversation and appends subsequent turns to its file", async () => {
    const target = makeSession({
      id: "sess_target",
      messages: [makeUserMessage("earlier question")],
      updatedAt: "2025-06-01T10:00:00.000Z",
    })
    const other = makeSession({
      id: "sess_other",
      messages: [makeUserMessage("other convo")],
      updatedAt: "2025-01-01T10:00:00.000Z",
    })
    const { lastFrame, capturedMessages, sessionsDir, typeAndSubmit, pressKey, unmount } =
      setupSwitcher([target, other])
    try {
      await until(() => (lastFrame() ?? "").includes("Type your message"))

      await typeAndSubmit("/session")
      await until(() => (lastFrame() ?? "").includes("sess_target"))
      await pressKey("\r")

      await until(() => (lastFrame() ?? "").includes("Switched to session sess_target"))
      expect(lastFrame() ?? "").toContain("earlier question")

      await typeAndSubmit("follow up question")
      await until(() => {
        if (!existsSync(join(sessionsDir, "sess_target.json"))) return false
        return readFileSync(join(sessionsDir, "sess_target.json"), "utf-8").includes("follow up question")
      })

      const saved = JSON.parse(readFileSync(join(sessionsDir, "sess_target.json"), "utf-8")) as Session
      const texts = saved.messages.map((m) =>
        m.content.filter((c) => c.type === "text").map((c) => (c.type === "text" ? c.text : "")).join(""),
      )
      expect(texts).toContain("earlier question")
      expect(texts).toContain("follow up question")
      expect(capturedMessages.at(-1)!.map((m) => m.content.filter((c) => c.type === "text").map((c) => (c.type === "text" ? c.text : "")).join(""))).toContain("earlier question")
    } finally {
      unmount()
      rmSync(sessionsDir, { recursive: true, force: true })
    }
  })
})
