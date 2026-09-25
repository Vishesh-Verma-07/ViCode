import React from "react"
import { describe, it, expect } from "bun:test"
import { mkdtempSync, existsSync, readFileSync, readdirSync, rmSync, mkdirSync, writeFileSync } from "fs"
import { tmpdir } from "os"
import { join } from "path"
import { EventEmitter } from "events"
import { render as inkRender } from "ink"
import { render } from "ink-testing-library"
import { App, FeedbackLine, STREAMING_COMMAND_NOTICE, extractDiff } from "@/ui/app"
import { ICONS } from "@/ui/theme"
import { CommandRegistry } from "@/core/command-registry"
import { createHelpCommand } from "@/commands/help"
import { createSessionCommand } from "@/commands/session"
import { createNewCommand } from "@/commands/new"
import { createExitCommand } from "@/commands/exit"
import { createModelCommand } from "@/commands/model"
import { createHomeCommand } from "@/commands/home"
import { createKeyCommand } from "@/commands/key"
import { saveSession, loadSession, type Session } from "@/core/session"
import type { Command, Message, ToolDefinition } from "@/core/types"
import type { Provider, StreamEvent, ModelListing } from "@/core/provider"
import { z } from "zod"
import { allTools } from "@/tools/index"
import { createSkillCommand } from "@/commands/skill"

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
    async listModels() {
      return []
    },
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
  registry.register({
    name: "echo",
    description: "Echoes its arguments",
    execute: async (args) => args.join(" "),
  })
  return registry.getAll()
}

function normalizeFrame(lastFrame: () => string | undefined): () => string {
  return () =>
    (lastFrame() ?? "")
      .replace(/\u001B\[[0-9;]*m/g, "")
      .replace(/\s+/g, " ")
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
        context={{ projectPath: join(sessionsDir, "project") }}
        initialApiKey="test-key"
        sessionsDir={sessionsDir}
        initialView="chat"
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

  it("renders command feedback as display-only entries excluded from provider messages and saved session JSON, and does not repeat it in later responses", async () => {
    const { stdin, lastFrame, capturedMessages, sessionsDir, typeAndSubmit, unmount } = setup()
    try {
      await until(() => (lastFrame() ?? "").includes("Type your message"))

      await typeAndSubmit("/noop")
      await until(() => (lastFrame() ?? "").includes("noop done"))

      await typeAndSubmit("hello world")
      await until(() => capturedMessages.length > 0)
      await until(() => (lastFrame() ?? "").includes("hello world"))

      const frame = lastFrame() ?? ""
      expect(frame).not.toContain("noop done")
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

describe("App command suggestion dropdown", () => {
  function setup() {
    const capturedMessages: Message[][] = []
    const provider = createStubProvider(capturedMessages)
    const instance = render(
      <App
        provider={provider}
        tools={[]}
        context={{ projectPath: "/tmp/suggestion-test" }}
        initialApiKey="test-key"
        initialView="chat"
        commands={createTestCommands()}
      />,
    )

    async function typeText(text: string): Promise<void> {
      for (const char of text) {
        instance.stdin.write(char)
        await new Promise((resolve) => setTimeout(resolve, 5))
      }
    }

    async function pressKey(key: string): Promise<void> {
      instance.stdin.write(key)
      await new Promise((resolve) => setTimeout(resolve, 20))
    }

    return { ...instance, capturedMessages, typeText, pressKey }
  }

  it("opens the dropdown listing every registered command when / is typed", async () => {
    const { lastFrame, typeText, unmount } = setup()
    try {
      await until(() => (lastFrame() ?? "").includes("Type your message"))
      await typeText("/")
      await until(() => (lastFrame() ?? "").includes("> /help"))

      const frame = lastFrame() ?? ""
      expect(frame).toContain("/help")
      expect(frame).toContain("List available commands")
      expect(frame).toContain("/noop")
      expect(frame).toContain("Does nothing")

      const hintIndex = frame.indexOf("Type a message to start chatting")
      const dropdownLineIndex = frame.indexOf("> /help")
      const statusBarIndex = frame.indexOf("Tokens: 0 | Cost:")
      expect(hintIndex).toBeGreaterThanOrEqual(0)
      expect(dropdownLineIndex).toBeGreaterThan(hintIndex)
      expect(dropdownLineIndex).toBeLessThan(statusBarIndex)
    } finally {
      unmount()
    }
  })

  it("does not show the dropdown for non-command input", async () => {
    const { lastFrame, typeText, unmount } = setup()
    try {
      await until(() => (lastFrame() ?? "").includes("Type your message"))
      await typeText("hello /world")
      await new Promise((resolve) => setTimeout(resolve, 50))
      expect(lastFrame() ?? "").not.toContain("> /help")
    } finally {
      unmount()
    }
  })

  it("filters case-insensitively as you type", async () => {
    const { lastFrame, typeText, unmount } = setup()
    try {
      await until(() => (lastFrame() ?? "").includes("Type your message"))
      await typeText("/NO")
      await until(() => (lastFrame() ?? "").includes("> /noop"))

      const frame = lastFrame() ?? ""
      expect(frame).toContain("/noop")
      expect(frame).not.toContain("/help")
    } finally {
      unmount()
    }
  })

  it("shows the no-commands-match message instead of vanishing", async () => {
    const { lastFrame, typeText, unmount } = setup()
    try {
      await until(() => (lastFrame() ?? "").includes("Type your message"))
      await typeText("/frobnicate")
      await until(() => (lastFrame() ?? "").includes("no commands match"))

      const frame = lastFrame() ?? ""
      expect(frame).toContain("no commands match")
      expect(frame).not.toContain("> /help")
    } finally {
      unmount()
    }
  })

  it("moves the highlight with arrow keys and executes on Enter without hitting the LLM", async () => {
    const { lastFrame, capturedMessages, typeText, pressKey, unmount } = setup()
    try {
      await until(() => (lastFrame() ?? "").includes("Type your message"))
      await typeText("/")
      await until(() => (lastFrame() ?? "").includes("> /help"))
      expect(lastFrame() ?? "").not.toContain("> /noop")

      await pressKey("\u001B[B")
      await until(() => (lastFrame() ?? "").includes("> /noop"))

      await pressKey("\r")
      await until(() => (lastFrame() ?? "").includes("noop done"))

      expect(capturedMessages).toHaveLength(0)
      expect(lastFrame() ?? "").not.toContain("You:")
    } finally {
      unmount()
    }
  })

  it("executes the highlighted command under its canonical name while preserving typed arguments", async () => {
    const { lastFrame, capturedMessages, typeText, pressKey, unmount } = setup()
    try {
      await until(() => (lastFrame() ?? "").includes("Type your message"))
      await typeText("/EC hello")
      await until(() => (lastFrame() ?? "").includes("> /echo"))

      await pressKey("\r")
      await until(() => (lastFrame() ?? "").includes("hello"))

      expect(lastFrame() ?? "").toContain("hello")
      expect(capturedMessages).toHaveLength(0)
      expect(lastFrame() ?? "").not.toContain("You:")
    } finally {
      unmount()
    }
  })

  it("dismisses on Escape, reopens on the next change, and normal chat still works", async () => {
    const { lastFrame, capturedMessages, typeText, pressKey, unmount } = setup()
    try {
      await until(() => (lastFrame() ?? "").includes("Type your message"))
      await typeText("/h")
      await until(() => (lastFrame() ?? "").includes("- List available commands"))

      await pressKey("\u001B")
      await until(() => !(lastFrame() ?? "").includes("- List available commands"))

      await typeText("x")
      await until(() => (lastFrame() ?? "").includes("no commands match"))

      for (let i = 0; i < 3; i++) {
        await pressKey("\u007F")
      }
      await until(() => !(lastFrame() ?? "").includes("no commands match"))

      await typeText("hello world")
      await pressKey("\r")
      await until(() => (lastFrame() ?? "").includes("You:"))

      const frame = lastFrame() ?? ""
      expect(frame).toContain("hello world")
      expect(frame).not.toContain("List available commands")
      expect(capturedMessages.length).toBeGreaterThan(0)
    } finally {
      unmount()
    }
  })
})

describe("App inline chip rendering", () => {
  function makeChipSession(): Session {
    return {
      id: "sess_chips",
      model: "stub-model",
      messages: [
        {
          id: "msg_user_chips",
          role: "user",
          content: [{ type: "text", text: "try `bun run` on this" }],
          timestamp: Date.now(),
        },
        {
          id: "msg_assistant_chips",
          role: "assistant",
          content: [{ type: "text", text: "Run `bunx tsc` then verify with `bun test`." }],
          timestamp: Date.now(),
        },
      ],
      createdAt: "2025-01-15T10:30:00.000Z",
      updatedAt: "2025-01-15T10:35:00.000Z",
      totalTokens: 0,
      totalCost: 0,
    }
  }

  it("renders inline backtick spans as chips without literal backticks for both user and assistant text", async () => {
    const instance = render(
      <App
        provider={createStubProvider([])}
        tools={[]}
        context={{ projectPath: "/tmp/chips-test" }}
        initialApiKey="test-key"
        initialSession={makeChipSession()}
        commands={createTestCommands()}
      />,
    )
    try {
      await until(() => (instance.lastFrame() ?? "").includes("bunx tsc"))
      const frame = (instance.lastFrame() ?? "").replace(/\u001B\[[0-9;]*m/g, "")
      expect(frame).toContain("bun run")
      expect(frame).toContain("bunx tsc")
      expect(frame).toContain("bun test")
      expect(frame).not.toContain("`")
    } finally {
      instance.unmount()
    }
  })

  it("keeps prose runs in the message alongside the chips", async () => {
    const instance = render(
      <App
        provider={createStubProvider([])}
        tools={[]}
        context={{ projectPath: "/tmp/chips-test" }}
        initialApiKey="test-key"
        initialSession={makeChipSession()}
        commands={createTestCommands()}
      />,
    )
    try {
      await until(() => (instance.lastFrame() ?? "").includes("verify with"))
      const frame = (instance.lastFrame() ?? "").replace(/\u001B\[[0-9;]*m/g, "")
      expect(frame).toContain("Run")
      expect(frame).toContain("then verify with")
      expect(frame).toContain("try")
      expect(frame).toContain("on this")
    } finally {
      instance.unmount()
    }
  })
})

describe("App session switcher", () => {
  function makeSession(overrides?: Partial<Session>): Session {
    return {
      id: "sess_seed",
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
        context={{ projectPath: join(sessionsDir, "project") }}
        initialApiKey="test-key"
        sessionsDir={sessionsDir}
        initialView="chat"
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
  }, 30000)

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
      expect(capturedMessages.at(-1)!.map((m) => m.content.filter((c) => c.type === "text").map((c) => (c.type === "text" ? c.text : "")).join(""))      ).toContain("earlier question")
    } finally {
      unmount()
      rmSync(sessionsDir, { recursive: true, force: true })
    }
  }, 30000)

  it("shows the loaded session's stored token and cost totals in the status bar", async () => {
    const target = makeSession({
      id: "sess_totals",
      messages: [makeUserMessage("totally counted convo")],
      totalTokens: 42,
      totalCost: 0.05,
      updatedAt: "2025-06-01T10:00:00.000Z",
    })
    const { lastFrame, sessionsDir, typeAndSubmit, pressKey, unmount } = setupSwitcher([target])
    try {
      await until(() => (lastFrame() ?? "").includes("Type your message"))
      expect(lastFrame() ?? "").not.toContain("Tokens: 42")

      await typeAndSubmit("/session")
      await until(() => (lastFrame() ?? "").includes("sess_totals"))
      await pressKey("\r")

      await until(() => (lastFrame() ?? "").includes("Switched to session sess_totals"))

      const frame = lastFrame() ?? ""
      expect(frame).toContain("Tokens: 42")
      expect(frame).toContain("$0.050")
    } finally {
      unmount()
      rmSync(sessionsDir, { recursive: true, force: true })
    }
  }, 30000)
})

describe("App model switcher", () => {
  const LISTINGS: ModelListing[] = [
    { id: "free-alpha", name: "Alpha", pricing: { kind: "free" } },
    {
      id: "paid-beta",
      name: "Beta",
      pricing: { kind: "paid", inputPricePerToken: 2 / 1_000_000, outputPricePerToken: 8 / 1_000_000 },
    },
  ]

  function setupModelSwitcher() {
    const handledBy: string[] = []
    const capturedMessages: Message[][] = []
    const eventsByModel: Record<string, StreamEvent[]> = {
      "free-alpha": [
        { type: "finish", usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2, cost: 0.001 } },
      ],
      "paid-beta": [
        { type: "text-delta", text: "ok" },
        { type: "finish", usage: { inputTokens: 3, outputTokens: 3, totalTokens: 6, cost: 0.002 } },
      ],
    }
    const createProvider = (modelId: string): Provider => ({
      getModelInfo: () => ({ id: modelId, name: `MODEL:${modelId}:ACTIVE` }),
      async listModels() {
        return [...LISTINGS]
      },
      async *streamChat(messages) {
        capturedMessages.push([...messages])
        handledBy.push(modelId)
        for (const event of eventsByModel[modelId] ?? []) yield event
      },
    })
    const provider = createProvider("free-alpha")
    const sessionsDir = mkdtempSync(join(tmpdir(), "vicode-model-test-"))
    const registry = new CommandRegistry()
    registry.register(createHelpCommand(registry))
    registry.register(createModelCommand())

    const instance = render(
      <App
        provider={provider}
        createProvider={createProvider}
        tools={[]}
        context={{ projectPath: join(sessionsDir, "project") }}
        initialApiKey="test-key"
        sessionsDir={sessionsDir}
        initialView="chat"
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

    return { ...instance, capturedMessages, handledBy, sessionsDir, typeAndSubmit, pressKey }
  }

  it("switches models mid-session: status bar updates immediately, the next turn uses the new model, and totals accumulate", async () => {
    const { lastFrame, handledBy, sessionsDir, stdin, typeAndSubmit, pressKey, unmount } = setupModelSwitcher()
    try {
      await until(() => (lastFrame() ?? "").includes("Type your message"))

      await typeAndSubmit("first question")
      await until(() => handledBy.length >= 1)
      await until(() => (lastFrame() ?? "").includes("Tokens: 2"))
      expect(handledBy).toEqual(["free-alpha"])

      await typeAndSubmit("/model")
      await until(() => (lastFrame() ?? "").includes("Alpha"))
      const frameWithPicker = lastFrame() ?? ""
      expect(frameWithPicker).toContain("free-alpha · free")
      expect(frameWithPicker).toContain("paid-beta · $2.00/M in · $8.00/M out")

      for (let i = 0; i < 10 && !(lastFrame() ?? "").includes("> Beta"); i++) {
        stdin.write("\u001B[B")
        await new Promise((resolve) => setTimeout(resolve, 30))
      }
      expect(lastFrame()).toContain("> Beta")
      await pressKey("\r")

      await until(() => (lastFrame() ?? "").includes("Switched to Beta"))

      expect(lastFrame()).toContain("MODEL:paid-beta:ACTIVE")
      expect(lastFrame()).toContain("Tokens: 2")

      await typeAndSubmit("second question")
      await until(() => handledBy.length >= 2)
      await until(() => (lastFrame() ?? "").includes("Tokens: 8"))
      expect(handledBy[1]).toBe("paid-beta")
      expect(lastFrame()).toContain("$0.003")

      await until(() => {
        if (!existsSync(sessionsDir)) return false
        const files = readdirSync(sessionsDir).filter((f) => f.endsWith(".json"))
        if (files.length === 0) return false
        return files.some((f) => readFileSync(join(sessionsDir, f), "utf-8").includes("MODEL:paid-beta:ACTIVE"))
      })

      const handledCountBefore = handledBy.length
      await typeAndSubmit("/model")
      await until(() => (lastFrame() ?? "").includes("Beta (current)"))
      expect(lastFrame()).not.toContain("Alpha (current)")
      await pressKey("\u001B")
      await until(() => !(lastFrame() ?? "").includes("Switch model"))

      expect(lastFrame()).toContain("MODEL:paid-beta:ACTIVE")
      expect(handledBy.length).toBe(handledCountBefore)
    } finally {
      unmount()
      rmSync(sessionsDir, { recursive: true, force: true })
    }
  }, 30000)

  it("marks the active model and no other in the picker listing", async () => {
    const { lastFrame, sessionsDir, typeAndSubmit, pressKey, unmount } = setupModelSwitcher()
    try {
      await until(() => (lastFrame() ?? "").includes("Type your message"))

      await typeAndSubmit("/model")
      await until(() => (lastFrame() ?? "").includes("Alpha (current)"))

      const frame = lastFrame() ?? ""
      expect(frame).not.toContain("Beta (current)")

      await pressKey("\u001B")
      await until(() => !(lastFrame() ?? "").includes("Switch model"))
    } finally {
      unmount()
      rmSync(sessionsDir, { recursive: true, force: true })
    }
  }, 30000)
})

class TestStdout extends EventEmitter {
  get columns() {
    return 100
  }

  frames: string[] = []
  private lastFrameValue?: string

  write = (frame: string) => {
    this.frames.push(frame)
    this.lastFrameValue = frame
  }

  lastFrame = () => this.lastFrameValue
}

class TestStdin extends EventEmitter {
  isTTY = true
  data: string | null = null

  constructor(options: { isTTY?: boolean } = {}) {
    super()
    this.isTTY = options.isTTY ?? true
  }

  write = (data: string) => {
    this.data = data
    this.emit("readable")
    this.emit("data", data)
  }

  setEncoding() {}
  setRawMode() {}
  resume() {}
  pause() {}
  ref() {}
  unref() {}

  read = () => {
    const { data } = this
    this.data = null
    return data
  }
}

describe("App /new command", () => {
  function makeSeedSession(): Session {
    return {
      id: "sess_seed_one",
      model: "stub-model",
      messages: [
        { id: "msg_seed", role: "user", content: [{ type: "text", text: "hello seed conversation" }], timestamp: Date.now() },
      ],
      createdAt: "2025-01-15T10:30:00.000Z",
      updatedAt: "2025-01-15T10:35:00.000Z",
      totalTokens: 7,
      totalCost: 0.001,
    }
  }

  const stampTool: ToolDefinition = {
    name: "stamp",
    description: "Stamp the project",
    dangerous: false,
    parameters: z.object({}),
    execute: async () =>
      "stamped\n__DIFF_START__\n--- a/file.txt\n+++ b/file.txt\n@@ -1 +1 @@\n-old\n+new\n__DIFF_END__",
  }

  function setupLifecycle(seedSession: Session | undefined) {
    const capturedMessages: Message[][] = []
    let streamCall = 0
    const provider: Provider = {
      getModelInfo: () => ({ id: "stub-model", name: "stub-model" }),
      async listModels() {
        return []
      },
      async *streamChat(messages) {
        capturedMessages.push([...messages])
        let events: StreamEvent[]
        if (streamCall === 0) {
          events = [
            { type: "tool-call-start", toolCallId: "t1", toolName: "stamp" },
            { type: "tool-call-end", toolCallId: "t1", toolName: "stamp", args: {} },
            { type: "finish", usage: { inputTokens: 3, outputTokens: 3, totalTokens: 6, cost: 0 } },
          ]
        } else if (streamCall === 1) {
          events = [{ type: "finish", usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0, cost: 0 } }]
        } else {
          events = [{ type: "finish", usage: { inputTokens: 5, outputTokens: 5, totalTokens: 10, cost: 0 } }]
        }
        streamCall++
        for (const event of events) yield event
      },
    }

    const sessionsDir = mkdtempSync(join(tmpdir(), "vicode-new-test-"))
    if (seedSession) saveSession(seedSession, sessionsDir)

    const registry = new CommandRegistry()
    registry.register(createHelpCommand(registry))
    registry.register(createNewCommand())

    const instance = render(
      <App
        provider={provider}
        tools={[stampTool]}
        context={{ projectPath: join(sessionsDir, "project") }}
        initialApiKey="test-key"
        initialSession={seedSession}
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

  it("persists the current conversation and clears chat panel, sidebar entries and usage counters; the next message starts a brand-new session", async () => {
    const seed = makeSeedSession()
    const { lastFrame, capturedMessages, sessionsDir, typeAndSubmit, pressKey, unmount } = setupLifecycle(seed)
    try {
      await until(() => (lastFrame() ?? "").includes("hello seed conversation"))

      await typeAndSubmit("turn one question")
      await until(() => (lastFrame() ?? "").includes("stamp"))
      await until(() => (lastFrame() ?? "").includes("Tokens: 6"))

      pressKey("\t")
      await until(() => (lastFrame() ?? "").includes("+new"))
      const frameBeforeNew = lastFrame() ?? ""
      expect(frameBeforeNew).toContain("-old")
      expect(frameBeforeNew).toContain("file.txt")

      await typeAndSubmit("/new")

      await until(() => (lastFrame() ?? "").includes("Started a new session"))
      const frameAfterNew = lastFrame() ?? ""
      expect(frameAfterNew).not.toContain("hello seed conversation")
      expect(frameAfterNew).not.toContain("turn one question")
      expect(frameAfterNew).toContain("Tokens: 0")
      expect(frameAfterNew).toContain("$0.00")
      expect(existsSync(join(sessionsDir, "sess_seed_one.json"))).toBe(true)

      const resumable = loadSession("sess_seed_one", sessionsDir)
      expect(resumable).not.toBeNull()
      const resumableTexts = JSON.stringify(resumable!.messages)
      expect(resumableTexts).toContain("hello seed conversation")
      expect(resumableTexts).toContain("turn one question")

      await typeAndSubmit("fresh start message")
      await until(() => capturedMessages.length >= 3)
      await until(() => (lastFrame() ?? "").includes("Tokens: 10"))

      expect(lastFrame()).toContain("fresh start message")
      const lastContextTexts = JSON.stringify(capturedMessages.at(-1))
      expect(lastContextTexts).toContain("fresh start message")
      expect(lastContextTexts).not.toContain("hello seed conversation")

      const files = readdirSync(sessionsDir).filter((f) => f.endsWith(".json")).sort()
      expect(files).toHaveLength(2)
      expect(files).toContain("sess_seed_one.json")
      const freshFile = files.find((f) => f !== "sess_seed_one.json")!
      expect(freshFile.startsWith("sess_")).toBe(true)
      const freshRaw = readFileSync(join(sessionsDir, freshFile), "utf-8")
      expect(freshRaw).toContain("fresh start message")
      expect(freshRaw).not.toContain("hello seed conversation")
    } finally {
      unmount()
      rmSync(sessionsDir, { recursive: true, force: true })
    }
  }, 30000)
})

describe("App /exit command", () => {
  function makeSeedSession(id: string): Session {
    return {
      id,
      model: "stub-model",
      messages: [],
      createdAt: "2025-01-15T10:30:00.000Z",
      updatedAt: "2025-01-15T10:35:00.000Z",
      totalTokens: 0,
      totalCost: 0,
    }
  }

  function expectExitWithin(instance: { waitUntilExit(): Promise<unknown> }, timeoutMs = 5000): Promise<void> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("app did not exit after /exit")), timeoutMs)
      instance.waitUntilExit().then(
        () => {
          clearTimeout(timer)
          resolve()
        },
        () => {
          clearTimeout(timer)
          resolve()
        },
      )
    })
  }

  function setupExitApp(provider: Provider, seedSession?: Session) {
    const sessionsDir = mkdtempSync(join(tmpdir(), "vicode-exit-test-"))
    if (seedSession) saveSession(seedSession, sessionsDir)

    const registry = new CommandRegistry()
    registry.register(createHelpCommand(registry))
    registry.register(createExitCommand())

    const stdout = new TestStdout()
    const stderr = new TestStdout()
    const stdin = new TestStdin()
    const instance = inkRender(
      <App
        provider={provider}
        tools={[]}
        context={{ projectPath: join(sessionsDir, "project") }}
        initialApiKey="test-key"
        initialSession={seedSession}
        sessionsDir={sessionsDir}
        commands={registry.getAll()}
      />,
      { stdout, stderr, stdin, debug: true, exitOnCtrlC: false, patchConsole: false } as unknown as Parameters<typeof inkRender>[1],
    )

    async function typeAndSubmit(text: string): Promise<void> {
      for (const char of text) {
        stdin.write(char)
        await new Promise((resolve) => setTimeout(resolve, 5))
      }
      stdin.write("\r")
    }

    return { instance, stdout, stdin, sessionsDir, typeAndSubmit }
  }

  it("exits normally via /exit when no stream is in progress", async () => {
    const seed = makeSeedSession("sess_exit_idle")
    const stubProvider: Provider = {
      getModelInfo: () => ({ id: "stub-model", name: "stub-model" }),
      async listModels() {
        return []
      },
      async *streamChat() {
        yield { type: "finish", usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0, cost: 0 } }
      },
    }
    const { instance, stdout, sessionsDir, typeAndSubmit } = setupExitApp(stubProvider, seed)
    try {
      await until(() => (stdout.lastFrame() ?? "").includes("Type your message"))

      await typeAndSubmit("/exit")

      await expectExitWithin(instance)
    } finally {
      instance.unmount()
      rmSync(sessionsDir, { recursive: true, force: true })
    }
  }, 30000)

  it("aborts an in-flight response via /exit, saves the conversation and exits", async () => {
    const capturedMessages: Message[][] = []
    let abortObserved = false
    const hangingProvider: Provider = {
      getModelInfo: () => ({ id: "stub-model", name: "stub-model" }),
      async listModels() {
        return []
      },
      async *streamChat(messages, _tools, _systemPrompt, abortSignal) {
        capturedMessages.push([...messages])
        yield { type: "text-delta", text: "partial reply" }
        await new Promise<void>((resolve) => {
          if (abortSignal?.aborted) {
            resolve()
            return
          }
          abortSignal?.addEventListener("abort", () => resolve(), { once: true })
        })
        abortObserved = true
        yield { type: "finish", usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0, cost: 0 } }
      },
    }
    const seed = makeSeedSession("sess_exit_streaming")
    const { instance, stdout, sessionsDir, typeAndSubmit } = setupExitApp(hangingProvider, seed)
    try {
      await until(() => (stdout.lastFrame() ?? "").includes("Type your message"))

      await typeAndSubmit("persist me")
      await until(() => (stdout.lastFrame() ?? "").includes("partial reply"))

      await typeAndSubmit("/exit")

      await expectExitWithin(instance)

      expect(abortObserved).toBe(true)

      const raw = readFileSync(join(sessionsDir, "sess_exit_streaming.json"), "utf-8")
      expect(raw).toContain("persist me")
    } finally {
      instance.unmount()
      rmSync(sessionsDir, { recursive: true, force: true })
    }
  }, 30000)
})

describe("App streaming guard for commands", () => {
  function setupGuarded() {
    const capturedMessages: Message[][] = []
    const hangingProvider: Provider = {
      getModelInfo: () => ({ id: "stub-model", name: "stub-model" }),
      async listModels() {
        return []
      },
      async *streamChat(messages, _tools, _systemPrompt, abortSignal) {
        capturedMessages.push([...messages])
        yield { type: "text-delta", text: "partial reply" }
        await new Promise<void>((resolve) => {
          if (abortSignal?.aborted) {
            resolve()
            return
          }
          abortSignal?.addEventListener("abort", () => resolve(), { once: true })
        })
        yield { type: "finish", usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0, cost: 0 } }
      },
    }
    const instance = render(
      <App
        provider={hangingProvider}
        tools={[]}
        context={{ projectPath: "/tmp/guard-test" }}
        initialApiKey="test-key"
        initialView="chat"
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

    return { ...instance, capturedMessages, typeAndSubmit }
  }

  it("rejects non-exit commands with a gentle notice while streaming and changes nothing", async () => {
    const { lastFrame, capturedMessages, typeAndSubmit, unmount } = setupGuarded()
    const frameText = () =>
      (lastFrame() ?? "")
        .replace(/\u001B\[[0-9;]*m/g, "")
        .replace(/\s+/g, " ")
    try {
      await until(() => (lastFrame() ?? "").includes("Type your message"))

      await typeAndSubmit("first question")
      await until(() => (lastFrame() ?? "").includes("partial reply"))

      await typeAndSubmit("/help")
      await until(() => frameText().includes(STREAMING_COMMAND_NOTICE))

      expect(frameText()).not.toContain("List available commands")
      expect(capturedMessages).toHaveLength(1)
      expect((lastFrame() ?? "").split("You:").length - 1).toBe(1)

      await typeAndSubmit("/frobnicate")
      await until(() => frameText().split(STREAMING_COMMAND_NOTICE).length > 2)
      expect(frameText()).not.toContain("Unknown command")
      expect(capturedMessages).toHaveLength(1)
    } finally {
      unmount()
    }
  }, 30000)
})

describe("App status bar indicator", () => {
  function setupWithProvider(provider: Provider, tools: ToolDefinition[] = []) {
    const instance = render(
      <App
        provider={provider}
        tools={tools}
        context={{ projectPath: "/tmp/status-test" }}
        initialApiKey="test-key"
        initialView="chat"
        commands={createTestCommands()}
      />,
    )

    async function typeAndSubmit(text: string): Promise<void> {
      for (const char of text) {
        instance.stdin.write(char)
        await new Promise((resolve) => setTimeout(resolve, 5))
      }
      instance.stdin.write("\r")
      await new Promise((resolve) => setTimeout(resolve, 20))
    }

    return { ...instance, frameText: normalizeFrame(instance.lastFrame), typeAndSubmit }
  }

  it("shows Ready when idle", async () => {
    const { lastFrame, unmount } = setupWithProvider(createStubProvider([]))
    try {
      await until(() => (lastFrame() ?? "").includes("Type your message"))
      expect((lastFrame() ?? "")).toContain("Ready")
    } finally {
      unmount()
    }
  })

  it("shows Thinking while streaming, then Done with duration, then reverts to Ready after three seconds", async () => {
    const delayedProvider: Provider = {
      getModelInfo: () => ({ id: "stub-model", name: "stub-model" }),
      async listModels() {
        return []
      },
      async *streamChat() {
        await new Promise((resolve) => setTimeout(resolve, 300))
        yield { type: "text-delta", text: "hello" }
        yield { type: "finish", usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2, cost: 0 } }
      },
    }
    const { lastFrame, frameText, typeAndSubmit, unmount } = setupWithProvider(delayedProvider)
    try {
      await until(() => (lastFrame() ?? "").includes("Type your message"))

      await typeAndSubmit("first question")
      await until(() => frameText().includes("Thinking"))

      await until(() => /Done in [0-9]+\.[0-9]s/.test(frameText()))
      expect(frameText()).not.toContain("Thinking")

      await until(() => frameText().includes("Ready") && !frameText().includes("Done in"), 6000)
    } finally {
      unmount()
    }
  }, 15000)

  it("shows a persistent Error when the stream fails, cleared by the next send", async () => {
    let calls = 0
    const failingThenWorkingProvider: Provider = {
      getModelInfo: () => ({ id: "stub-model", name: "stub-model" }),
      async listModels() {
        return []
      },
      async *streamChat(messages) {
        calls++
        if (calls === 1) {
          throw new Error("boom")
        }
        await new Promise((resolve) => setTimeout(resolve, 300))
        for (const event of [
          { type: "text-delta" as const, text: "recovered" },
          { type: "finish" as const, usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2, cost: 0 } },
        ]) {
          yield event
        }
      },
    }
    const { lastFrame, frameText, typeAndSubmit, unmount } = setupWithProvider(failingThenWorkingProvider)
    try {
      await until(() => (lastFrame() ?? "").includes("Type your message"))

      await typeAndSubmit("break it")
      await until(() => frameText().includes("Error"))

      await new Promise((resolve) => setTimeout(resolve, 300))
      expect(frameText()).toContain("Error")

      await typeAndSubmit("fix it")
      await until(() => frameText().includes("Thinking"))
      await until(() => /Done in [0-9]+\.[0-9]s/.test(frameText()))
      expect(frameText()).not.toContain("✗ Error")
    } finally {
      unmount()
    }
  }, 15000)

  it("reverts straight to Ready when Esc aborts a turn mid-stream", async () => {
    const hangingProvider: Provider = {
      getModelInfo: () => ({ id: "stub-model", name: "stub-model" }),
      async listModels() {
        return []
      },
      async *streamChat(_messages, _tools, _systemPrompt, abortSignal) {
        yield { type: "text-delta", text: "partial reply" }
        await new Promise<void>((resolve) => {
          if (abortSignal?.aborted) {
            resolve()
            return
          }
          abortSignal?.addEventListener("abort", () => resolve(), { once: true })
        })
      },
    }
    const { lastFrame, frameText, typeAndSubmit, stdin, unmount } = setupWithProvider(hangingProvider)
    try {
      await until(() => (lastFrame() ?? "").includes("Type your message"))

      await typeAndSubmit("slow question")
      await until(() => frameText().includes("Thinking"))

      stdin.write("\x1B")

      await until(() => frameText().includes("Ready"), 5000)
      expect(frameText()).not.toContain("Done in")
      expect(frameText()).not.toContain("Error")
    } finally {
      unmount()
    }
  }, 15000)

  it("shows Working with the tool name while a tool executes, then Thinking when the model resumes", async () => {
    const echoTool: ToolDefinition = {
      name: "echo",
      description: "Echo input",
      parameters: z.object({ input: z.string() }),
      execute: async () => {
        await new Promise((resolve) => setTimeout(resolve, 300))
        return "echoed"
      },
      dangerous: false,
    }
    let step = 0
    const toolCallingProvider: Provider = {
      getModelInfo: () => ({ id: "stub-model", name: "stub-model" }),
      async listModels() {
        return []
      },
      async *streamChat() {
        step++
        if (step === 1) {
          await new Promise((resolve) => setTimeout(resolve, 200))
          yield { type: "text-delta", text: "calling tool" }
          yield { type: "tool-call-start", toolCallId: "call_1", toolName: "echo" }
          yield { type: "tool-call-end", toolCallId: "call_1", toolName: "echo", args: { input: "hi" } }
          yield { type: "finish", usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2, cost: 0 } }
        } else {
          await new Promise((resolve) => setTimeout(resolve, 200))
          yield { type: "text-delta", text: "all done" }
          yield { type: "finish", usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2, cost: 0 } }
        }
      },
    }
    const { lastFrame, frameText, typeAndSubmit, unmount } = setupWithProvider(toolCallingProvider, [echoTool])
    try {
      await until(() => (lastFrame() ?? "").includes("Type your message"))

      await typeAndSubmit("use the tool")
      await until(() => frameText().includes("Thinking"))
      await until(() => frameText().includes("Working: echo"))

      await until(() => frameText().includes("Thinking") && !frameText().includes("Working"))
      await until(() => /Done in [0-9]+\.[0-9]s/.test(frameText()))
    } finally {
      unmount()
    }
  }, 15000)

  it("shows each sequential tool call under its own name", async () => {
    const alphaTool: ToolDefinition = {
      name: "alpha",
      description: "Alpha",
      parameters: z.object({}),
      execute: async () => {
        await new Promise((resolve) => setTimeout(resolve, 250))
        return "alpha result"
      },
      dangerous: false,
    }
    const betaTool: ToolDefinition = {
      name: "beta",
      description: "Beta",
      parameters: z.object({}),
      execute: async () => {
        await new Promise((resolve) => setTimeout(resolve, 250))
        return "beta result"
      },
      dangerous: false,
    }
    let step = 0
    const twoToolProvider: Provider = {
      getModelInfo: () => ({ id: "stub-model", name: "stub-model" }),
      async listModels() {
        return []
      },
      async *streamChat() {
        step++
        if (step === 1) {
          await new Promise((resolve) => setTimeout(resolve, 200))
          yield { type: "tool-call-start", toolCallId: "call_1", toolName: "alpha" }
          yield { type: "tool-call-end", toolCallId: "call_1", toolName: "alpha", args: {} }
          yield { type: "tool-call-start", toolCallId: "call_2", toolName: "beta" }
          yield { type: "tool-call-end", toolCallId: "call_2", toolName: "beta", args: {} }
          yield { type: "finish", usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2, cost: 0 } }
        } else {
          await new Promise((resolve) => setTimeout(resolve, 200))
          yield { type: "finish", usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2, cost: 0 } }
        }
      },
    }
    const { lastFrame, frameText, typeAndSubmit, unmount } = setupWithProvider(twoToolProvider, [alphaTool, betaTool])
    try {
      await until(() => (lastFrame() ?? "").includes("Type your message"))

      await typeAndSubmit("run both")
      await until(() => frameText().includes("Working: alpha"))

      await until(() => frameText().includes("Working: beta"))

      await until(() => /Done in [0-9]+\.[0-9]s/.test(frameText()))
    } finally {
      unmount()
    }
  }, 15000)

  it("shows Waiting for approval while a dangerous tool pauses, resuming Working after approve", async () => {
    const bashTool: ToolDefinition = {
      name: "bash",
      description: "Run shell command",
      parameters: z.object({ command: z.string() }),
      execute: async () => {
        await new Promise((resolve) => setTimeout(resolve, 250))
        return "ran"
      },
      dangerous: true,
    }
    let step = 0
    const approvalProvider: Provider = {
      getModelInfo: () => ({ id: "stub-model", name: "stub-model" }),
      async listModels() {
        return []
      },
      async *streamChat() {
        step++
        if (step === 1) {
          await new Promise((resolve) => setTimeout(resolve, 200))
          yield { type: "tool-call-start", toolCallId: "call_1", toolName: "bash" }
          yield { type: "tool-call-end", toolCallId: "call_1", toolName: "bash", args: { command: "ls" } }
          yield { type: "finish", usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2, cost: 0 } }
        } else {
          await new Promise((resolve) => setTimeout(resolve, 200))
          yield { type: "text-delta", text: "done now" }
          yield { type: "finish", usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2, cost: 0 } }
        }
      },
    }
    const { lastFrame, frameText, typeAndSubmit, stdin, unmount } = setupWithProvider(approvalProvider, [bashTool])
    try {
      await until(() => (lastFrame() ?? "").includes("Type your message"))

      await typeAndSubmit("run ls")
      await until(() => frameText().includes("Waiting for approval"))

      await new Promise((resolve) => setTimeout(resolve, 200))
      expect(frameText()).toContain("Waiting for approval")

      stdin.write("y")

      await until(() => frameText().includes("Working: bash"))
      await until(() => /Done in [0-9]+\.[0-9]s/.test(frameText()))
    } finally {
      unmount()
    }
  }, 15000)

  it("clears the waiting state and finishes the turn when the user rejects", async () => {
    const bashTool: ToolDefinition = {
      name: "bash",
      description: "Run shell command",
      parameters: z.object({ command: z.string() }),
      execute: async () => "should not run",
      dangerous: true,
    }
    let step = 0
    const approvalProvider: Provider = {
      getModelInfo: () => ({ id: "stub-model", name: "stub-model" }),
      async listModels() {
        return []
      },
      async *streamChat() {
        step++
        if (step === 1) {
          await new Promise((resolve) => setTimeout(resolve, 200))
          yield { type: "tool-call-start", toolCallId: "call_1", toolName: "bash" }
          yield { type: "tool-call-end", toolCallId: "call_1", toolName: "bash", args: { command: "rm" } }
          yield { type: "finish", usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2, cost: 0 } }
        } else {
          await new Promise((resolve) => setTimeout(resolve, 200))
          yield { type: "text-delta", text: "moving on" }
          yield { type: "finish", usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2, cost: 0 } }
        }
      },
    }
    const { lastFrame, frameText, typeAndSubmit, stdin, unmount } = setupWithProvider(approvalProvider, [bashTool])
    try {
      await until(() => (lastFrame() ?? "").includes("Type your message"))

      await typeAndSubmit("run rm")
      await until(() => frameText().includes("Waiting for approval"))

      stdin.write("n")

      await until(() => /Done in [0-9]+\.[0-9]s/.test(frameText()))
      expect(frameText()).not.toContain("Waiting for approval")
    } finally {
      unmount()
    }
  }, 15000)

  it("reaches Error after an approval pause when the resumed stream fails", async () => {
    const bashTool: ToolDefinition = {
      name: "bash",
      description: "Run shell command",
      parameters: z.object({ command: z.string() }),
      execute: async () => "ran",
      dangerous: true,
    }
    let step = 0
    const approvalThenErrorProvider: Provider = {
      getModelInfo: () => ({ id: "stub-model", name: "stub-model" }),
      async listModels() {
        return []
      },
      async *streamChat() {
        step++
        if (step === 1) {
          await new Promise((resolve) => setTimeout(resolve, 200))
          yield { type: "tool-call-start", toolCallId: "call_1", toolName: "bash" }
          yield { type: "tool-call-end", toolCallId: "call_1", toolName: "bash", args: { command: "ls" } }
          yield { type: "finish", usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2, cost: 0 } }
        } else {
          await new Promise((resolve) => setTimeout(resolve, 200))
          yield { type: "error", error: new Error("stream blew up") }
        }
      },
    }
    const { lastFrame, frameText, typeAndSubmit, stdin, unmount } = setupWithProvider(approvalThenErrorProvider, [bashTool])
    try {
      await until(() => (lastFrame() ?? "").includes("Type your message"))

      await typeAndSubmit("run ls then fail")
      await until(() => frameText().includes("Waiting for approval"))

      stdin.write("y")

      await until(() => frameText().includes("✗ Error"))
      expect(frameText()).not.toContain("Waiting for approval")
      expect(frameText()).not.toContain("Done in")
    } finally {
      unmount()
    }
  }, 15000)

  function makeSequentialToolProvider(
    toolName: string,
    args: Record<string, unknown>,
    callsPerTurn: number,
  ): Provider {
    let callsMade = 0
    return {
      getModelInfo: () => ({ id: "stub-model", name: "stub-model" }),
      async listModels() {
        return []
      },
      async *streamChat(messages) {
        await new Promise((resolve) => setTimeout(resolve, 200))
        const isTurnStart = messages[messages.length - 1]?.role === "user"
        if (isTurnStart && callsMade < callsPerTurn) {
          callsMade++
          yield { type: "tool-call-start", toolCallId: `call_${callsMade}`, toolName }
          yield { type: "tool-call-end", toolCallId: `call_${callsMade}`, toolName, args }
        }
        yield { type: "finish", usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2, cost: 0 } }
      },
    }
  }

  function makeSameTurnToolProvider(
    toolName: string,
    args: Record<string, unknown>,
    calls: number,
  ): Provider {
    let callsMade = 0
    return {
      getModelInfo: () => ({ id: "stub-model", name: "stub-model" }),
      async listModels() {
        return []
      },
      async *streamChat() {
        await new Promise((resolve) => setTimeout(resolve, 200))
        if (callsMade < calls) {
          callsMade++
          yield { type: "tool-call-start", toolCallId: `call_${callsMade}`, toolName }
          yield { type: "tool-call-end", toolCallId: `call_${callsMade}`, toolName, args }
        }
        yield { type: "finish", usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2, cost: 0 } }
      },
    }
  }

  it("auto-approves later calls to the same path within a turn after one approval", async () => {
    const writeFileTool: ToolDefinition = {
      name: "write_file",
      description: "Write file",
      parameters: z.object({ path: z.string(), content: z.string() }),
      execute: async () => "written",
      dangerous: true,
    }
    const provider = makeSameTurnToolProvider("write_file", { path: ".env", content: "v" }, 2)
    const { lastFrame, frameText, typeAndSubmit, stdin, unmount } = setupWithProvider(provider, [writeFileTool])
    try {
      await until(() => (lastFrame() ?? "").includes("Type your message"))

      await typeAndSubmit("write twice")
      await until(() => frameText().includes("Waiting for approval"))
      stdin.write("y")
      await until(() => /Done in [0-9]+\.[0-9]s/.test(frameText()), 8000)
    } finally {
      unmount()
    }
  }, 20000)

  it("asks again for the same path in a fresh turn after an approval", async () => {
    const writeFileTool: ToolDefinition = {
      name: "write_file",
      description: "Write file",
      parameters: z.object({ path: z.string(), content: z.string() }),
      execute: async () => "written",
      dangerous: true,
    }
    const twoWritesProvider = makeSequentialToolProvider("write_file", { path: ".env", content: "v" }, 3)
    const { lastFrame, frameText, typeAndSubmit, stdin, unmount } = setupWithProvider(twoWritesProvider, [writeFileTool])
    try {
      await until(() => (lastFrame() ?? "").includes("Type your message"))

      await typeAndSubmit("first write")
      await until(() => frameText().includes("Waiting for approval"))
      stdin.write("y")
      await until(() => /Done in [0-9]+\.[0-9]s/.test(frameText()))

      await typeAndSubmit("second write")
      await until(() => frameText().includes("Waiting for approval"), 8000)
      stdin.write("y")
      await until(() => /Done in [0-9]+\.[0-9]s/.test(frameText()))
    } finally {
      unmount()
    }
  }, 20000)

  it("asks again when the previous write to that file was rejected", async () => {
    const writeFileTool: ToolDefinition = {
      name: "write_file",
      description: "Write file",
      parameters: z.object({ path: z.string(), content: z.string() }),
      execute: async () => "written",
      dangerous: true,
    }
    const twoWritesProvider = makeSequentialToolProvider("write_file", { path: ".env", content: "v" }, 3)
    const { lastFrame, frameText, typeAndSubmit, stdin, unmount } = setupWithProvider(twoWritesProvider, [writeFileTool])
    try {
      await until(() => (lastFrame() ?? "").includes("Type your message"))

      await typeAndSubmit("first write")
      await until(() => frameText().includes("Waiting for approval"))
      stdin.write("n")
      await until(() => /Done in [0-9]+\.[0-9]s/.test(frameText()))

      await typeAndSubmit("second write")
      await until(() => frameText().includes("Waiting for approval"), 8000)
      stdin.write("y")
      await until(() => /Done in [0-9]+\.[0-9]s/.test(frameText()))
    } finally {
      unmount()
    }
  }, 20000)

  it("does not extend the once-approved treatment to bash", async () => {
    const bashTool: ToolDefinition = {
      name: "bash",
      description: "Run shell command",
      parameters: z.object({ command: z.string() }),
      execute: async () => "ran",
      dangerous: true,
    }
    const twoRunsProvider = makeSequentialToolProvider("bash", { command: "echo hi" }, 3)
    const { lastFrame, frameText, typeAndSubmit, stdin, unmount } = setupWithProvider(twoRunsProvider, [bashTool])
    try {
      await until(() => (lastFrame() ?? "").includes("Type your message"))

      await typeAndSubmit("first run")
      await until(() => frameText().includes("Waiting for approval"))
      stdin.write("y")
      await until(() => /Done in [0-9]+\.[0-9]s/.test(frameText()))

      await typeAndSubmit("second run")
      await until(() => frameText().includes("Waiting for approval"), 8000)
      stdin.write("y")
      await until(() => /Done in [0-9]+\.[0-9]s/.test(frameText()))
    } finally {
      unmount()
    }
  }, 20000)
})

describe("App chat scrolling", () => {
  function setupScrolling(provider: Provider) {
    const instance = render(
      <App
        provider={provider}
        tools={[]}
        context={{ projectPath: "/tmp/scroll-test" }}
        initialApiKey="test-key"
        initialView="chat"
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

    function pressKey(sequence: string): void {
      instance.stdin.write(sequence)
    }

    const frameText = () =>
      (instance.lastFrame() ?? "")
        .replace(/\u001B\[[0-9;]*m/g, "")
        .replace(/\s+/g, " ")

    return { ...instance, typeAndSubmit, pressKey, frameText }
  }

  function bigStreamProvider(lines: number, chunkDelayMs = 0): Provider {
    return {
      getModelInfo: () => ({ id: "stub-model", name: "stub-model" }),
      async listModels() {
        return []
      },
      async *streamChat() {
        if (chunkDelayMs > 0) await new Promise((resolve) => setTimeout(resolve, chunkDelayMs))
        yield { type: "text-delta", text: "HEAD_MARKER\n" }
        for (let i = 0; i < lines; i++) {
          yield { type: "text-delta", text: `filler line ${i}\n` }
          if (chunkDelayMs > 0) await new Promise((resolve) => setTimeout(resolve, chunkDelayMs))
        }
        yield { type: "text-delta", text: "TAIL_MARKER" }
        yield { type: "finish", usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2, cost: 0 } }
      },
    }
  }

  it("auto-follows the stream so the latest output stays visible and the head is clipped", async () => {
    const { lastFrame, typeAndSubmit, unmount } = setupScrolling(bigStreamProvider(300))
    try {
      await until(() => (lastFrame() ?? "").includes("Type your message"))

      await typeAndSubmit("write a lot")
      await until(() => (lastFrame() ?? "").includes("TAIL_MARKER"), 20000)

      const frame = lastFrame() ?? ""
      expect(frame).toContain("TAIL_MARKER")
      expect(frame).not.toContain("HEAD_MARKER")
    } finally {
      unmount()
    }
  }, 30000)

  it("PageUp scrolls into history showing the hint, End returns to the live bottom", async () => {
    const { lastFrame, frameText, typeAndSubmit, pressKey, unmount } = setupScrolling(bigStreamProvider(300))
    try {
      await until(() => (lastFrame() ?? "").includes("Type your message"))

      await typeAndSubmit("write a lot")
      await until(() => (lastFrame() ?? "").includes("TAIL_MARKER"), 20000)
      expect(frameText()).not.toContain("End to return")

      let scrolledToTop = false
      for (let i = 0; i < 60 && !scrolledToTop; i++) {
        pressKey("\x1B[5~")
        await new Promise((resolve) => setTimeout(resolve, 20))
        scrolledToTop = (lastFrame() ?? "").includes("HEAD_MARKER")
      }
      expect(scrolledToTop).toBe(true)

      pressKey("\x1B[F")
      await until(() => (lastFrame() ?? "").includes("TAIL_MARKER"))
      expect(frameText()).not.toContain("End to return")
    } finally {
      unmount()
    }
  }, 30000)

  it("pauses auto-follow while scrolled up during streaming", async () => {
    const { lastFrame, frameText, typeAndSubmit, pressKey, unmount } = setupScrolling(bigStreamProvider(40, 150))
    try {
      await until(() => (lastFrame() ?? "").includes("Type your message"))

      await typeAndSubmit("slowly write a lot")

      let paused = false
      for (let i = 0; i < 80 && !paused; i++) {
        pressKey("\x1B[5~")
        await new Promise((resolve) => setTimeout(resolve, 100))
        paused = frameText().includes("End to return")
      }
      expect(paused).toBe(true)

      await until(() => frameText().includes("✓ Done in"), 30000)
      expect(frameText()).not.toContain("TAIL_MARKER")
      expect(frameText()).toMatch(/filler line \d+/)
      expect(frameText()).toContain("End to return")
    } finally {
      unmount()
    }
  }, 15000)
})

describe("App fenced code block rendering", () => {
  function setupFencedAssistant(text: string) {
    const events: StreamEvent[] = [
      { type: "text-delta", text },
      { type: "finish", usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2, cost: 0 } },
    ]
    const provider = createStubProvider([], events)
    const instance = render(
      <App
        provider={provider}
        tools={[]}
        context={{ projectPath: "/tmp/code-block-test" }}
        initialApiKey="test-key"
        initialView="chat"
        commands={createTestCommands()}
      />,
    )
    const frameText = normalizeFrame(instance.lastFrame)

    async function typeAndSubmit(text: string): Promise<void> {
      for (const char of text) {
        instance.stdin.write(char)
        await new Promise((resolve) => setTimeout(resolve, 5))
      }
      instance.stdin.write("\r")
      await new Promise((resolve) => setTimeout(resolve, 20))
    }

    return { ...instance, frameText, typeAndSubmit }
  }

  it("renders fenced assistant text as a framed Code Block with no literal backticks and a border in the frame", async () => {
    const fencedText = "Here is a snippet:\n```bash\necho hi\n```\nDone."
    const { lastFrame, frameText, typeAndSubmit, unmount } = setupFencedAssistant(fencedText)
    try {
      await until(() => frameText().includes("Type your message"))

      await typeAndSubmit("show me code")
      await until(() => frameText().includes("echo hi"))

      const out = frameText()
      expect(out).not.toContain("```")
      expect(/[┌└]/.test(out)).toBe(true)
      expect(out).toContain("bash")
      expect(out).toContain("echo hi")
      expect(out).toContain("Done.")
      expect(out).toContain("Here is a snippet:")
    } finally {
      unmount()
    }
  }, 30000)

  it("shows fenced code from stored assistant messages (after turn completes)", async () => {
    const fencedText = "Run this:\n```js\nconst x = 1\n```\nDone"
    const { lastFrame, frameText, typeAndSubmit, unmount } = setupFencedAssistant(fencedText)
    try {
      await until(() => frameText().includes("Type your message"))

      await typeAndSubmit("run it")
      await until(() => /Done in [0-9]+\.[0-9]s/.test(frameText()))
      await until(() => frameText().includes("Done"))

      const out = frameText()
      expect(out).not.toContain("```")
      expect(out).toContain("const x = 1")
      expect(out).toContain("js")
      expect(/[┌└]/.test(out)).toBe(true)
      expect(out).toContain("vicode:")
    } finally {
      unmount()
    }
  }, 30000)
})

describe("App mouse wheel scrolling", () => {
  function setupWheel(provider: Provider) {
    const instance = render(
      <App
        provider={provider}
        tools={[]}
        context={{ projectPath: "/tmp/wheel-test" }}
        initialApiKey="test-key"
        initialView="chat"
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

    const frameText = () =>
      (instance.lastFrame() ?? "")
        .replace(/\u001B\[[0-9;]*m/g, "")
        .replace(/\s+/g, " ")

    const anyFrameContaining = (needle: string) =>
      instance.stdout.frames.some((f) => f.includes(needle))

    return { ...instance, typeAndSubmit, frameText, anyFrameContaining }
  }

  it("enables mouse tracking on mount and disables it on unmount", async () => {
    const { stdout, unmount } = setupWheel(createStubProvider([]))
    try {
      await until(() => stdout.frames.some((f) => f.includes("\u001B[?1000h")))
    } finally {
      unmount()
    }
    expect(stdout.frames.some((f) => f.includes("\u001B[?1000l"))).toBe(true)
  })

  it("scrolls history with wheel-up and returns with wheel-down without leaking junk into the input", async () => {
    const provider = createStubProvider([], [
      { type: "text-delta", text: Array.from({ length: 200 }, (_, i) => `wheel filler ${i}`).join("\n") },
      { type: "finish", usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2, cost: 0 } },
    ])
    const { lastFrame, frameText, typeAndSubmit, stdin, anyFrameContaining, unmount } = setupWheel(provider)
    try {
      await until(() => anyFrameContaining("Type your message"))

      await typeAndSubmit("fill the screen")
      await until(() => frameText().includes("✓ Done in"))

      for (let i = 0; i < 25 && !frameText().includes("End to return"); i++) {
        stdin.write("\u001B[<64;10;5M")
        await new Promise((resolve) => setTimeout(resolve, 20))
      }
      expect(frameText()).toContain("End to return")

      for (let i = 0; i < 40 && frameText().includes("End to return"); i++) {
        stdin.write("\u001B[<65;10;5M")
        await new Promise((resolve) => setTimeout(resolve, 20))
      }
      expect(frameText()).not.toContain("End to return")

      expect(frameText()).not.toMatch(/<6[45];/)
      expect(frameText()).not.toContain("<64")
    } finally {
      unmount()
    }
  }, 30000)
})

describe("Inline tool bubbles in chat", () => {
  function setupTools(provider: Provider, tools: ToolDefinition[]) {
    const instance = render(
      <App
        provider={provider}
        tools={tools}
        context={{ projectPath: "/tmp/bubble-test" }}
        initialApiKey="test-key"
        initialView="chat"
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

    const frameText = () =>
      (instance.lastFrame() ?? "")
        .replace(/\u001B\[[0-9;]*m/g, "")
        .replace(/\s+/g, " ")

    return { ...instance, typeAndSubmit, frameText }
  }

  const echoTool: ToolDefinition = {
    name: "echo",
    description: "Echo",
    parameters: z.object({}),
    execute: async () => {
      await new Promise((resolve) => setTimeout(resolve, 250))
      return "echoed"
    },
    dangerous: false,
  }

  it("shows a dim running line while a tool executes, then the completed bubble with summary", async () => {
    let step = 0
    const provider: Provider = {
      getModelInfo: () => ({ id: "stub", name: "stub" }),
      async listModels() { return [] },
      async *streamChat() {
        step++
        if (step === 1) {
          await new Promise((resolve) => setTimeout(resolve, 150))
          yield { type: "tool-call-start", toolCallId: "c1", toolName: "echo" }
          yield { type: "tool-call-end", toolCallId: "c1", toolName: "echo", args: {} }
          yield { type: "finish", usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2, cost: 0 } }
        } else {
          yield { type: "finish", usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2, cost: 0 } }
        }
      },
    }
    const { lastFrame, frameText, typeAndSubmit, unmount } = setupTools(provider, [echoTool])
    try {
      await until(() => (lastFrame() ?? "").includes("Type your message"))

      await typeAndSubmit("use echo")
      await until(() => frameText().includes("⚙ echo…"), 5000)

      await until(() => /⚙ echo\b/.test(frameText()) && !frameText().includes("⚙ echo…"), 5000)
      expect(frameText()).toContain("echoed")
    } finally {
      unmount()
    }
  }, 20000)

  it("renders past tool activity from persisted history after the turn", async () => {
    let step = 0
    const provider: Provider = {
      getModelInfo: () => ({ id: "stub", name: "stub" }),
      async listModels() { return [] },
      async *streamChat() {
        step++
        if (step === 1) {
          yield { type: "tool-call-start", toolCallId: "c1", toolName: "echo" }
          yield { type: "tool-call-end", toolCallId: "c1", toolName: "echo", args: {} }
          yield { type: "finish", usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2, cost: 0 } }
        } else {
          yield { type: "text-delta", text: "all finished" }
          yield { type: "finish", usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2, cost: 0 } }
        }
      },
    }
    const { lastFrame, frameText, typeAndSubmit, unmount } = setupTools(provider, [echoTool])
    try {
      await until(() => (lastFrame() ?? "").includes("Type your message"))

      await typeAndSubmit("use echo")
      await until(() => frameText().includes("all finished"), 10000)

      expect(frameText()).toContain("⚙ echo")
      expect(frameText()).toContain("echoed")
    } finally {
      unmount()
    }
  }, 20000)

  it("truncates long results to three lines with an overflow marker", async () => {
    const longTool: ToolDefinition = {
      name: "spew",
      description: "Spew lines",
      parameters: z.object({}),
      execute: async () => Array.from({ length: 10 }, (_, i) => `out ${i}`).join("\n"),
      dangerous: false,
    }
    let step = 0
    const provider: Provider = {
      getModelInfo: () => ({ id: "stub", name: "stub" }),
      async listModels() { return [] },
      async *streamChat() {
        step++
        if (step === 1) {
          yield { type: "tool-call-start", toolCallId: "c1", toolName: "spew" }
          yield { type: "tool-call-end", toolCallId: "c1", toolName: "spew", args: {} }
          yield { type: "finish", usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2, cost: 0 } }
        } else {
          yield { type: "finish", usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2, cost: 0 } }
        }
      },
    }
    const { lastFrame, frameText, typeAndSubmit, unmount } = setupTools(provider, [longTool])
    try {
      await until(() => (lastFrame() ?? "").includes("Type your message"))

      await typeAndSubmit("spew")
      await until(() => frameText().includes("out 2"), 10000)

      expect(frameText()).toContain("out 2")
      expect(frameText()).toContain("more lines")
    } finally {
      unmount()
    }
  }, 20000)

  it("renders diffs inline when the result contains diff markers", async () => {
    const DIFF_START = "__DIFF_START__"
    const DIFF_END = "__DIFF_END__"
    const editTool: ToolDefinition = {
      name: "edit-file",
      description: "Edit",
      parameters: z.object({}),
      execute: async () =>
        `Edited.\n${DIFF_START}\n--- a/f.ts\n+++ b/f.ts\n@@ -1 +1 @@\n-old line\n+new line\n${DIFF_END}`,
      dangerous: false,
    }
    let step = 0
    const provider: Provider = {
      getModelInfo: () => ({ id: "stub", name: "stub" }),
      async listModels() { return [] },
      async *streamChat() {
        step++
        if (step === 1) {
          yield { type: "tool-call-start", toolCallId: "c1", toolName: "edit-file" }
          yield { type: "tool-call-end", toolCallId: "c1", toolName: "edit-file", args: {} }
          yield { type: "finish", usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2, cost: 0 } }
        } else {
          yield { type: "finish", usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2, cost: 0 } }
        }
      },
    }
    const { lastFrame, frameText, typeAndSubmit, unmount } = setupTools(provider, [editTool])
    try {
      await until(() => (lastFrame() ?? "").includes("Type your message"))

      await typeAndSubmit("edit it")
      await until(() => frameText().includes("+new line"), 10000)

      expect(frameText()).toContain("-old line")
      expect(frameText()).toContain("@@ -1 +1 @@")
    } finally {
      unmount()
    }
  }, 20000)

  it("frames executed bash output with the $ Command Line from the tool-call args and the overflow hint in-frame", async () => {
    const bashLike: ToolDefinition = {
      name: "bash",
      description: "Run shell command",
      parameters: z.object({ command: z.string() }),
      execute: async ({ command }) =>
        Array.from({ length: 10 }, (_, i) => `${command} output line ${i + 1}`).join("\n"),
      dangerous: false,
    }
    let step = 0
    const provider: Provider = {
      getModelInfo: () => ({ id: "stub", name: "stub" }),
      async listModels() { return [] },
      async *streamChat() {
        step++
        if (step === 1) {
          await new Promise((resolve) => setTimeout(resolve, 100))
          yield { type: "tool-call-start", toolCallId: "c1", toolName: "bash" }
          yield { type: "tool-call-end", toolCallId: "c1", toolName: "bash", args: { command: "npm test" } }
          yield { type: "finish", usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2, cost: 0 } }
        } else {
          yield { type: "finish", usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2, cost: 0 } }
        }
      },
    }
    const { lastFrame, frameText, typeAndSubmit, unmount } = setupTools(provider, [bashLike])
    try {
      await until(() => (lastFrame() ?? "").includes("Type your message"))

      await typeAndSubmit("run the tests")
      await until(() => frameText().includes("$ npm test"), 10000)

      const out = frameText()
      expect(out).toContain("$ npm test")
      expect(out.indexOf("$ npm test")).toBeGreaterThan(out.lastIndexOf("⚙ bash"))
      expect(out).toContain("+7 more lines")
      expect(/[┌└]/.test(out)).toBe(true)
    } finally {
      unmount()
    }
  }, 20000)

  it("frames non-bash tool output without a Command Line when the tool has no command arg", async () => {
    const inspectTool: ToolDefinition = {
      name: "inspect",
      description: "Inspect",
      parameters: z.object({}),
      execute: async () => Array.from({ length: 5 }, (_, i) => `inspect line ${i + 1}`).join("\n"),
      dangerous: false,
    }
    let step = 0
    const provider: Provider = {
      getModelInfo: () => ({ id: "stub", name: "stub" }),
      async listModels() { return [] },
      async *streamChat() {
        step++
        if (step === 1) {
          await new Promise((resolve) => setTimeout(resolve, 100))
          yield { type: "tool-call-start", toolCallId: "c1", toolName: "inspect" }
          yield { type: "tool-call-end", toolCallId: "c1", toolName: "inspect", args: {} }
          yield { type: "finish", usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2, cost: 0 } }
        } else {
          yield { type: "finish", usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2, cost: 0 } }
        }
      },
    }
    const { lastFrame, frameText, typeAndSubmit, unmount } = setupTools(provider, [inspectTool])
    try {
      await until(() => (lastFrame() ?? "").includes("Type your message"))

      await typeAndSubmit("inspect")
      await until(() => frameText().includes("inspect line 1"), 10000)

      const out = frameText()
      expect(out).toContain("⚙ inspect")
      expect(out).toContain("inspect line 1")
      expect(/[┌└]/.test(out)).toBe(true)
      expect(out).not.toContain("$ ")
    } finally {
      unmount()
    }
  }, 20000)
})

describe("Usage panel", () => {
  function setupUsage(provider: Provider) {
    const instance = render(
      <App
        provider={provider}
        tools={[]}
        context={{ projectPath: "/tmp/usage-test" }}
        initialApiKey="test-key"
        initialView="chat"
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

    const frameText = () =>
      (instance.lastFrame() ?? "")
        .replace(/\u001B\[[0-9;]*m/g, "")
        .replace(/\s+/g, " ")

    const anyFrameContaining = (needle: string) =>
      instance.stdout.frames.some((f) => f.includes(needle))

    return { ...instance, typeAndSubmit, frameText, anyFrameContaining }
  }

  it("shows model, token breakdown, cost and turn count, with no Tools/Diffs tabs", async () => {
    let step = 0
    const provider: Provider = {
      getModelInfo: () => ({ id: "stub-model", name: "stub-model" }),
      async listModels() { return [] },
      async *streamChat() {
        step++
        yield { type: "text-delta", text: `reply ${step}` }
        yield { type: "finish", usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15, cost: 0.01 } }
      },
    }
    const { frameText, typeAndSubmit, anyFrameContaining, unmount } = setupUsage(provider)
    try {
      await until(() => anyFrameContaining("Type your message"))

      expect(frameText()).not.toContain("Tools | Diffs")

      await typeAndSubmit("first")
      await until(() => frameText().includes("reply 1"), 10000)
      await typeAndSubmit("second")
      await until(() => frameText().includes("reply 2"), 10000)

      const usageSection = frameText().split("Usage")[1] ?? ""
      expect(frameText()).toContain("Usage")
      expect(usageSection).toContain("stub-model")
      expect(usageSection).toContain("Tokens: 30")
      expect(usageSection).toContain("In: 20 / Out: 10")
      expect(usageSection).toContain("$0.02")
      expect(usageSection).toContain("Turns: 2")
      expect(frameText()).not.toContain("No tool calls yet")
    } finally {
      unmount()
    }
  }, 30000)

  it("does not surface the diffs picker on Tab", async () => {
    const { frameText, stdin, anyFrameContaining, unmount } = setupUsage(createStubProvider([]))
    try {
      await until(() => anyFrameContaining("Type your message"))
      stdin.write("\t")
      await new Promise((resolve) => setTimeout(resolve, 200))
      expect(frameText()).not.toContain("Diffs")
    } finally {
      unmount()
    }
  }, 15000)
})

describe("Error surfacing", () => {
  it("shows the API error message as chat feedback alongside the error status", async () => {
    const failingProvider: Provider = {
      getModelInfo: () => ({ id: "stub-model", name: "stub-model" }),
      async listModels() {
        return []
      },
      async *streamChat() {
        yield { type: "error", error: new Error("Rate limit exceeded: free-models-per-day") }
      },
    }
    const instance = render(
      <App
        provider={failingProvider}
        tools={[]}
        context={{ projectPath: "/tmp/err-test" }}
        initialApiKey="test-key"
        initialView="chat"
        commands={createTestCommands()}
      />,
    )
    try {
      const frameText = () =>
        (instance.lastFrame() ?? "")
          .replace(/\u001B\[[0-9;]*m/g, "")
          .replace(/\s+/g, " ")
      await until(() => frameText().includes("Type your message"))
      instance.stdin.write("h")
      await new Promise((r) => setTimeout(r, 10))
      instance.stdin.write("\r")

      await until(() => frameText().includes("✗ Error"))
      expect(frameText()).toContain("Rate limit exceeded")
    } finally {
      instance.unmount()
    }
  }, 15000)
})

describe("Chat input mouse-byte immunity", () => {
  function setup() {
    const instance = render(
      <App
        provider={createStubProvider([])}
        tools={[]}
        context={{ projectPath: "/tmp/x10-test" }}
        initialApiKey="test-key"
        initialView="chat"
        commands={createTestCommands()}
      />,
    )
    const frameText = () =>
      (instance.lastFrame() ?? "")
        .replace(/\u001B\[[0-9;]*m/g, "")
        .replace(/\s+/g, " ")
    return { ...instance, frameText }
  }

  it("ignores a coalesced X10 click (all payload bytes in one burst) while typing still works", async () => {
    const { frameText, stdin, unmount } = setup()
    try {
      await until(() => frameText().includes("Type your message"))

      stdin.write("\u001B[M !!")
      await new Promise((r) => setTimeout(r, 100))
      expect(frameText()).not.toContain("!")
      expect(frameText()).not.toContain("&")

      for (const char of "hello") {
        stdin.write(char)
        await new Promise((r) => setTimeout(r, 5))
      }
      expect(frameText()).toContain("hello")
      expect(frameText()).not.toContain("!")
    } finally {
      unmount()
    }
  }, 15000)

  it("drops split X10 clicks delivered byte-by-byte after the [M prefix", async () => {
    const { frameText, stdin, unmount } = setup()
    try {
      await until(() => frameText().includes("Type your message"))

      stdin.write("\x1B[M")
      await new Promise((r) => setTimeout(r, 30))
      stdin.write("!")
      await new Promise((r) => setTimeout(r, 30))
      stdin.write("&")
      await new Promise((r) => setTimeout(r, 30))

      expect(frameText()).not.toContain("!")
      expect(frameText()).not.toContain("&")

      for (const char of "ok") {
        stdin.write(char)
        await new Promise((r) => setTimeout(r, 5))
      }
      expect(frameText()).toContain("ok")
    } finally {
      unmount()
    }
  }, 15000)

  it("drops repeated X10 clicks (bundled and split) without leaking junk or swallowing the next keystroke", async () => {
    const { frameText, stdin, unmount } = setup()
    try {
      await until(() => frameText().includes("Type your message"))

      for (let i = 0; i < 3; i++) {
        stdin.write("\u001B[M !!")
        await new Promise((r) => setTimeout(r, 10))
      }
      stdin.write("\x1B[M")
      await new Promise((r) => setTimeout(r, 10))
      stdin.write("!")
      await new Promise((r) => setTimeout(r, 10))
      stdin.write("&")
      await new Promise((r) => setTimeout(r, 10))
      stdin.write("\u001B[M !!")
      await new Promise((r) => setTimeout(r, 10))

      expect(frameText()).not.toContain("!")
      expect(frameText()).not.toContain("&")

      for (const char of "hi") {
        stdin.write(char)
        await new Promise((r) => setTimeout(r, 5))
      }
      expect(frameText()).toContain("hi")
    } finally {
      unmount()
    }
  }, 15000)

  it("wheel-up SGR press scrolls chat; click SGR does not type characters", async () => {
    const provider = createStubProvider([], [
      { type: "text-delta", text: Array.from({ length: 200 }, (_, i) => `filler ${i}`).join("\n") },
      { type: "finish", usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2, cost: 0 } },
    ])
    const { frameText, typeAndSubmit, stdin, lastFrame, unmount } = (() => {
      const instance = render(
        <App
          provider={provider}
          tools={[]}
          context={{ projectPath: "/tmp/wheel-click-test" }}
          initialApiKey="test-key"
          initialView="chat"
          commands={createTestCommands()}
        />,
      )
      const ft = () =>
        (instance.lastFrame() ?? "")
          .replace(/\u001B\[[0-9;]*m/g, "")
          .replace(/\s+/g, " ")
      async function ts(text: string) {
        for (const c of text) { instance.stdin.write(c); await new Promise((r) => setTimeout(r, 5)) }
        instance.stdin.write("\r")
      }
      return { ...instance, frameText: ft, typeAndSubmit: ts }
    })()
    try {
      await until(() => frameText().includes("Type your message"))
      await typeAndSubmit("fill screen")
      await until(() => frameText().includes("Done in"), 15000)

      let scrolledUp = false
      for (let i = 0; i < 25 && !scrolledUp; i++) {
        stdin.write("\u001B[<64;10;5M")
        await new Promise((r) => setTimeout(r, 20))
        scrolledUp = frameText().includes("End to return")
      }
      expect(scrolledUp).toBe(true)

      stdin.write("\u001B[<0;10;5M")
      await new Promise((r) => setTimeout(r, 50))
      const frameAfterClick = frameText()
      expect(frameAfterClick).not.toContain("<0;10;5M")

      for (const char of "typed after click") {
        stdin.write(char)
        await new Promise((r) => setTimeout(r, 5))
      }
      expect(frameText()).toContain("typed after click")
      expect(frameText()).not.toMatch(/<\d+;\d+;\d+M/)
    } finally {
      unmount()
    }
  }, 30000)
})

describe("ChatInput word deletion", () => {
  async function typedFrame(initialKeys: string[]): Promise<{ frameText: () => string; unmount: () => void }> {
    const instance = render(
      <App
        provider={createStubProvider([])}
        tools={[]}
        context={{ projectPath: "/tmp/wdel-test" }}
        initialApiKey="test-key"
        initialView="chat"
        commands={createTestCommands()}
      />,
    )
    const frameText = () =>
      (instance.lastFrame() ?? "")
        .replace(/\u001B\[[0-9;]*m/g, "")
        .replace(/\s+/g, " ")
    await until(() => frameText().includes("Type your message"))
    for (const key of initialKeys) {
      instance.stdin.write(key)
      await new Promise((r) => setTimeout(r, 5))
    }
    return { frameText, unmount: instance.unmount }
  }

  it("Ctrl+W deletes the previous word", async () => {
    const { frameText, unmount } = await typedFrame([
      ..."hello beautiful world",
      "\u0017",
    ])
    try {
      await until(() => frameText().includes("hello"))
      expect(frameText()).not.toContain("world")
      expect(frameText()).toContain("beautiful")
    } finally {
      unmount()
    }
  }, 15000)

  it("Alt+Backspace deletes the previous word including trailing spaces", async () => {
    const { frameText, unmount } = await typedFrame([
      ..."foo bar   ",
      "\u001B\u007F",
    ])
    try {
      await until(() => frameText().includes("foo"))
      expect(frameText()).toContain("foo")
      expect(frameText()).not.toContain("bar")
    } finally {
      unmount()
    }
  }, 15000)

  it("Ctrl+Delete sequence (what a bare BS byte is rewritten to) deletes the previous word", async () => {
    const { frameText, unmount } = await typedFrame([
      ..."hello beautiful world",
      "\u001B[3;5~",
    ])
    try {
      await until(() => frameText().includes("hello"))
      expect(frameText()).toContain("hello beautiful")
      expect(frameText()).not.toContain("worl")
      expect(frameText()).not.toContain("world")
    } finally {
      unmount()
    }
  }, 15000)

  it("plain Backspace (DEL byte) still deletes a single character", async () => {
    const { frameText, unmount } = await typedFrame([
      ..."hello",
      "\u007f",
    ])
    try {
      await until(() => frameText().includes("hell"))
      expect(frameText()).toContain("hell")
      expect(frameText()).not.toContain("hello")
    } finally {
      unmount()
    }
  }, 15000)
})

describe("App Input History recall", () => {
  function setup(overrides?: { initialView?: "home" | "chat"; initialSession?: Session; sessionsDir?: string }) {
    const capturedMessages: Message[][] = []
    const provider = createStubProvider(capturedMessages)
    const instance = render(
      <App
        provider={provider}
        tools={[]}
        context={{ projectPath: "/tmp/history-recall-test" }}
        initialApiKey="test-key"
        initialView={overrides?.initialView ?? "chat"}
        initialSession={overrides?.initialSession}
        sessionsDir={overrides?.sessionsDir}
        commands={createTestCommands()}
      />,
    )
    const frameText = () =>
      (instance.lastFrame() ?? "").replace(/\u001B\[[0-9;]*m/g, "")
    const inputValue = () => {
      const line = frameText()
        .split("\n")
        .find((l) => l.trimStart().startsWith("→ "))
      return line ? line.replace(/^.*?→\s*/, "").trimEnd() : ""
    }
    const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
    async function typeText(text: string) {
      for (const c of text) {
        instance.stdin.write(c)
        await sleep(5)
      }
    }
    async function pressKey(key: string) {
      instance.stdin.write(key)
      await sleep(25)
    }
    async function submitMessage(text: string) {
      await typeText(text)
      instance.stdin.write("\r")
      await until(() => frameText().includes("Done in"))
    }
    return { ...instance, capturedMessages, frameText, inputValue, typeText, pressKey, submitMessage }
  }

  it("recalls the most recent Input first, one Input per Up press", async () => {
    const { inputValue, submitMessage, pressKey, unmount } = setup()
    try {
      await until(() => inputValue() === "Type your message...")
      await submitMessage("alpha")
      await submitMessage("beta")
      await submitMessage("gamma")

      await pressKey("\u001B[A")
      await until(() => inputValue() === "gamma")
      await pressKey("\u001B[A")
      await until(() => inputValue() === "beta")
      await pressKey("\u001B[A")
      await until(() => inputValue() === "alpha")
    } finally {
      unmount()
    }
  }, 30000)

  it("clamps at the oldest entry with no wrap-around", async () => {
    const { inputValue, submitMessage, pressKey, unmount } = setup()
    try {
      await submitMessage("alpha")
      await submitMessage("beta")
      await pressKey("\u001B[A")
      await until(() => inputValue() === "beta")
      await pressKey("\u001B[A")
      await until(() => inputValue() === "alpha")
      await pressKey("\u001B[A")
      await pressKey("\u001B[A")
      await until(() => inputValue() === "alpha")
      expect(inputValue()).toBe("alpha")
    } finally {
      unmount()
    }
  }, 30000)

  it("steps Down toward newer Inputs and returns to the preserved unsent draft, clamping below it", async () => {
    const { inputValue, typeText, submitMessage, pressKey, unmount } = setup()
    try {
      await submitMessage("alpha")
      await typeText("unsent draft text")
      await until(() => inputValue() === "unsent draft text")

      await pressKey("\u001B[A")
      await until(() => inputValue() === "alpha")
      await pressKey("\u001B[A")
      await until(() => inputValue() === "alpha")

      await pressKey("\u001B[B")
      await until(() => inputValue() === "unsent draft text")
      await pressKey("\u001B[B")
      await until(() => inputValue() === "unsent draft text")
    } finally {
      unmount()
    }
  }, 30000)

  it("editing a recalled Input detaches it as the new draft", async () => {
    const { inputValue, typeText, submitMessage, pressKey, unmount } = setup()
    try {
      await submitMessage("alpha")
      await submitMessage("beta")
      await pressKey("\u001B[A")
      await pressKey("\u001B[A")
      await until(() => inputValue() === "alpha")

      await typeText("!")
      await until(() => inputValue() === "alpha!")

      await pressKey("\u001B[B")
      await until(() => inputValue() === "alpha!")

      await pressKey("\u001B[A")
      await until(() => inputValue() === "beta")
    } finally {
      unmount()
    }
  }, 30000)

  it("submitting a recalled Input sends a fresh message Turn, not a replay", async () => {
    const { inputValue, capturedMessages, submitMessage, pressKey, unmount } = setup()
    try {
      await submitMessage("hello before")
      await until(() => capturedMessages.length === 1)

      await pressKey("\u001B[A")
      await until(() => inputValue() === "hello before")
      await pressKey("\r")
      await until(() => capturedMessages.length === 2)

      expect(inputValue()).toBe("Type your message...")
      expect(JSON.stringify(capturedMessages[1])).toContain("hello before")
    } finally {
      unmount()
    }
  }, 30000)

  it("records a typed slash Command for recall", async () => {
    const { inputValue, frameText, typeText, pressKey, unmount } = setup()
    try {
      await until(() => inputValue() === "Type your message...")
      await typeText("/help")
      await pressKey("\r")
      await until(() => (frameText().includes("/help -")))

      await pressKey("\u001B[A")
      await until(() => inputValue() === "/help")
    } finally {
      unmount()
    }
  }, 30000)

  it("records a slash Command chosen from the suggestion dropdown under its canonical name", async () => {
    const { inputValue, frameText, typeText, pressKey, unmount } = setup()
    try {
      await until(() => inputValue() === "Type your message...")
      await typeText("/no")
      await until(() => (frameText().includes("> /noop")))
      await pressKey("\r")
      await until(() => (frameText().includes("noop done")))

      await pressKey("\u001B[A")
      await until(() => inputValue() === "/noop")
    } finally {
      unmount()
    }
  }, 30000)

  it("records the first message submitted from the Welcome Screen and recalls it in chat", async () => {
    const { inputValue, frameText, typeText, pressKey, unmount } = setup({ initialView: "home" })
    try {
      await until(() => frameText().includes("AI-Powered Coding Assistant"))

      await typeText("hello from home")
      await pressKey("\r")
      await until(() => frameText().includes("You: hello from home"))

      await pressKey("\u001B[A")
      await until(() => inputValue() === "hello from home")
    } finally {
      unmount()
    }
  }, 30000)

  it("keeps Up/Down driving the Welcome menu instead of recalling history into its box", async () => {
    const seed: Session = {
      id: "sess_history_seed",
      model: "stub-model",
      messages: [],
      createdAt: "2025-01-15T10:30:00.000Z",
      updatedAt: "2025-01-15T10:35:00.000Z",
      totalTokens: 0,
      totalCost: 0,
    }
    const sessionsDir = mkdtempSync(join(tmpdir(), "vicode-history-menu-test-"))
    saveSession(seed, sessionsDir)
    const { inputValue, frameText, typeText, pressKey, unmount } = setup({ initialView: "home", initialSession: seed, sessionsDir })
    try {
      await until(() => frameText().includes("AI-Powered Coding Assistant"))
      await until(() => frameText().includes("Start a fresh conversation"))

      await typeText("welcome draft")
      await until(() => inputValue() === "welcome draft")

      await pressKey("\u001B[B")
      await until(() => frameText().includes("Continue where you left off"))
      expect(inputValue()).toBe("welcome draft")

      await pressKey("\u001B[A")
      await until(() => frameText().includes("Start a fresh conversation"))
      expect(inputValue()).toBe("welcome draft")
    } finally {
      unmount()
      rmSync(sessionsDir, { recursive: true, force: true })
    }
  }, 30000)
})

describe("App Input History lifecycle", () => {
  function makeSeedSession(id: string, texts: string[]): Session {
    return {
      id,
      model: "stub-model",
      messages: texts.map((text, i) => ({
        id: `msg_${id}_${i}`,
        role: "user" as const,
        content: [{ type: "text" as const, text }],
        timestamp: Date.now(),
      })),
      createdAt: "2025-01-15T10:30:00.000Z",
      updatedAt: "2025-01-15T10:35:00.000Z",
      totalTokens: 0,
      totalCost: 0,
    }
  }

  function setup(opts?: {
    initialView?: "home" | "chat"
    initialSession?: Session
    sessionsDir?: string
    commands?: Command[]
    provider?: Provider
  }) {
    const capturedMessages: Message[][] = []
    const provider = opts?.provider ?? createStubProvider(capturedMessages)
    const instance = render(
      <App
        provider={provider}
        tools={[]}
        context={{ projectPath: "/tmp/history-lifecycle-test" }}
        initialApiKey="test-key"
        initialView={opts?.initialView ?? "chat"}
        initialSession={opts?.initialSession}
        sessionsDir={opts?.sessionsDir}
        commands={opts?.commands}
      />,
    )
    const frameText = () =>
      (instance.lastFrame() ?? "").replace(/\u001B\[[0-9;]*m/g, "")
    const inputValue = () => {
      const line = frameText()
        .split("\n")
        .find((l) => l.trimStart().startsWith("→ "))
      return line ? line.replace(/^.*?→\s*/, "").trimEnd() : ""
    }
    const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
    async function typeText(text: string) {
      for (const c of text) {
        instance.stdin.write(c)
        await sleep(5)
      }
    }
    async function pressKey(key: string) {
      instance.stdin.write(key)
      await sleep(25)
    }
    async function submit(text: string) {
      await typeText(text)
      instance.stdin.write("\r")
      await until(() => frameText().includes("Done in"))
    }
    return { ...instance, capturedMessages, frameText, inputValue, typeText, pressKey, submit }
  }

  function helpOnlyRegistry(): Command[] {
    const registry = new CommandRegistry()
    registry.register(createHelpCommand(registry))
    return registry.getAll()
  }

  it("Welcome-Screen New Chat clears the Input History so Up recalls nothing and fresh Inputs start a new list", async () => {
    const registry = new CommandRegistry()
    registry.register(createHelpCommand(registry))
    registry.register(createHomeCommand())
    const { frameText, inputValue, typeText, pressKey, submit, unmount, stdin } = setup({
      initialView: "home",
      commands: registry.getAll(),
    })
    try {
      await until(() => frameText().includes("Ask anything or select an option..."))

      stdin.write("\r")
      await until(() => frameText().includes("Type your message"), 10000)

      await pressKey("\u001B[A")
      await new Promise((r) => setTimeout(r, 60))
      expect(inputValue()).toBe("Type your message...")

      await submit("first ever input")
      await submit("second input")

      await pressKey("\u001B[A")
      await until(() => inputValue() === "second input")

      await pressKey("\u001B[B")
      await until(() => inputValue() === "Type your message...")

      await typeText("/home")
      stdin.write("\r")
      await until(() => frameText().includes("Ask anything or select an option..."))

      stdin.write("\r")
      await until(() => frameText().includes("Type your message"), 10000)

      await pressKey("\u001B[A")
      await new Promise((r) => setTimeout(r, 60))
      expect(inputValue()).toBe("Type your message...")

      await submit("fresh start input")
      await pressKey("\u001B[A")
      await until(() => inputValue() === "fresh start input")
      await pressKey("\u001B[A")
      await new Promise((r) => setTimeout(r, 60))
      expect(inputValue()).toBe("fresh start input")
    } finally {
      unmount()
    }
  }, 30000)

  it("/new clears the Input History so Up recalls nothing and fresh Inputs start a new list", async () => {
    const sessionsDir = mkdtempSync(join(tmpdir(), "vicode-lifecycle-new-test-"))
    const registry = new CommandRegistry()
    registry.register(createHelpCommand(registry))
    registry.register(createNewCommand())
    const { frameText, inputValue, typeText, pressKey, submit, unmount, stdin } = setup({
      sessionsDir,
      commands: registry.getAll(),
    })
    try {
      await until(() => frameText().includes("Type your message"))
      await submit("alpha")
      await submit("beta")

      await pressKey("\u001B[A")
      await until(() => inputValue() === "beta")

      await pressKey("\u001B[B")
      await until(() => inputValue() === "Type your message...")

      await typeText("/new")
      stdin.write("\r")
      await until(() => frameText().includes("Started a new session"))

      await pressKey("\u001B[A")
      await new Promise((r) => setTimeout(r, 60))
      expect(inputValue()).toBe("Type your message...")

      await submit("fresh after new")
      await pressKey("\u001B[A")
      await until(() => inputValue() === "fresh after new")
      await pressKey("\u001B[A")
      await new Promise((r) => setTimeout(r, 60))
      expect(inputValue()).toBe("fresh after new")
    } finally {
      unmount()
      rmSync(sessionsDir, { recursive: true, force: true })
    }
  }, 30000)

  it("while the input is disabled (agent busy), Up/Down leave the draft alone and recall nothing", async () => {
    const capturedMessages: Message[][] = []
    const hangingProvider: Provider = {
      getModelInfo: () => ({ id: "stub-model", name: "stub-model" }),
      async listModels() {
        return []
      },
      async *streamChat(messages, _tools, _systemPrompt, abortSignal) {
        capturedMessages.push([...messages])
        yield { type: "text-delta", text: "busy partial" }
        await new Promise<void>((resolve) => {
          if (abortSignal?.aborted) {
            resolve()
            return
          }
          abortSignal?.addEventListener("abort", () => resolve(), { once: true })
        })
        yield { type: "finish", usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2, cost: 0 } }
      },
    }
    const { frameText, inputValue, typeText, pressKey, stdin, unmount } = setup({
      provider: hangingProvider,
      commands: helpOnlyRegistry(),
    })
    try {
      await until(() => frameText().includes("Type your message"))
      await typeText("hello")
      stdin.write("\r")
      await until(() => frameText().includes("busy partial"))

      await typeText("busy draft")
      await until(() => inputValue() === "busy draft")

      await pressKey("\u001B[A")
      await new Promise((r) => setTimeout(r, 60))
      expect(inputValue()).toBe("busy draft")
      await pressKey("\u001B[B")
      await new Promise((r) => setTimeout(r, 60))
      expect(inputValue()).toBe("busy draft")

      stdin.write("\x1B")
      const frameReady = () => frameText().includes("Ready")
      await until(frameReady, 5000)

      await pressKey("\u001B[A")
      await until(() => inputValue() === "hello")
    } finally {
      unmount()
    }
  }, 30000)

  it("resuming an older Session does not rebuild history from its Messages; only this run's Inputs are recallable", async () => {
    const sessionsDir = mkdtempSync(join(tmpdir(), "vicode-lifecycle-resume-test-"))
    const oldSeed = makeSeedSession("sess_old", ["ancient question"])
    saveSession(oldSeed, sessionsDir)

    const registry = new CommandRegistry()
    registry.register(createSessionCommand())
    registry.register(createHelpCommand(registry))

    const { frameText, inputValue, typeText, pressKey, submit, unmount, stdin } = setup({
      sessionsDir,
      commands: registry.getAll(),
    })
    try {
      await until(() => frameText().includes("Type your message"))
      await submit("current run input")

      await typeText("/session")
      stdin.write("\r")
      await until(() => frameText().includes("Switch to session"))
      await pressKey("\u001B[B")
      await pressKey("\r")
      await until(() => frameText().includes("Switched to session sess_old"))
      await until(() => frameText().includes("ancient question"))

      await pressKey("\u001B[A")
      await until(() => inputValue() === "/session")
      await pressKey("\x1B")
      await pressKey("\u001B[A")
      await until(() => inputValue() === "current run input")
      await pressKey("\u001B[A")
      await new Promise((r) => setTimeout(r, 60))
      expect(inputValue()).toBe("current run input")
      expect(inputValue()).not.toBe("ancient question")
    } finally {
      unmount()
      rmSync(sessionsDir, { recursive: true, force: true })
    }
  }, 30000)
})

describe("App Command Suggestion gating for recall", () => {
  function setup() {
    const capturedMessages: Message[][] = []
    const instance = render(
      <App
        provider={createStubProvider(capturedMessages)}
        tools={[]}
        context={{ projectPath: "/tmp/suggestion-gating-test" }}
        initialApiKey="test-key"
        initialView="chat"
        commands={createTestCommands()}
      />,
    )
    const frameText = () =>
      (instance.lastFrame() ?? "").replace(/\u001B\[[0-9;]*m/g, "")
    const inputValue = () => {
      const line = frameText()
        .split("\n")
        .find((l) => l.trimStart().startsWith("→ "))
      return line ? line.replace(/^.*?→\s*/, "").trimEnd() : ""
    }
    const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
    async function typeText(text: string) {
      for (const c of text) {
        instance.stdin.write(c)
        await sleep(5)
      }
    }
    async function pressKey(key: string) {
      instance.stdin.write(key)
      await sleep(25)
    }
    async function submitMessage(text: string) {
      await typeText(text)
      instance.stdin.write("\r")
      await until(() => frameText().includes("Done in"))
    }
    return { ...instance, capturedMessages, frameText, inputValue, typeText, pressKey, submitMessage }
  }

  it("keeps Up/Down moving the suggestion highlight while the dropdown is visible, without recalling history", async () => {
    const { inputValue, frameText, typeText, pressKey, submitMessage, unmount } = setup()
    try {
      await until(() => inputValue() === "Type your message...")
      await submitMessage("alpha")

      await typeText("/")
      await until(() => frameText().includes("> /help"))
      await pressKey("\u001B[B")
      await until(() => frameText().includes("> /noop"))
      await pressKey("\u001B[B")
      await until(() => frameText().includes("> /echo"))
      await pressKey("\u001B[A")
      await until(() => frameText().includes("> /noop"))

      expect(inputValue()).toBe("/")
    } finally {
      unmount()
    }
  }, 30000)

  it("recalls History once the dropdown is dismissed with Escape", async () => {
    const { inputValue, frameText, typeText, pressKey, submitMessage, unmount } = setup()
    try {
      await until(() => inputValue() === "Type your message...")
      await submitMessage("alpha")
      await submitMessage("beta")

      await typeText("/h")
      await until(() => frameText().includes("> /help"))
      await pressKey("\u001B")
      await until(() => !frameText().includes("> /help"))

      await pressKey("\u001B[A")
      await until(() => inputValue() === "beta")
      await pressKey("\u001B[A")
      await until(() => inputValue() === "alpha")
    } finally {
      unmount()
    }
  }, 30000)

  it("switches back to recalling History when the typed Input stops matching any Command", async () => {
    const { inputValue, frameText, typeText, pressKey, submitMessage, unmount } = setup()
    try {
      await until(() => inputValue() === "Type your message...")
      await submitMessage("alpha")

      await typeText("/frobnicate")
      await until(() => frameText().includes("no commands match"))

      await pressKey("\u001B[A")
      await until(() => inputValue() === "alpha")
      expect(frameText()).not.toContain("no commands match")
    } finally {
      unmount()
    }
  }, 30000)

  it("recalling an Input that starts with `/` recomputes the dropdown and reclaims Up/Down", async () => {
    const { inputValue, frameText, typeText, pressKey, unmount } = setup()
    try {
      await until(() => inputValue() === "Type your message...")

      await typeText("/echo hello")
      await pressKey("\r")
      await until(() => frameText().includes("hello"))

      await typeText("/no")
      await until(() => frameText().includes("> /noop"))
      await pressKey("\r")
      await until(() => frameText().includes("noop done"))

      await pressKey("\u001B[A")
      await until(() => inputValue() === "/noop")
      await until(() => frameText().includes("> /noop"))

      await pressKey("\u001B[B")
      await until(() => frameText().includes("> /noop"))
      expect(inputValue()).toBe("/noop")
    } finally {
      unmount()
    }
  }, 30000)

  it("recomputes the dropdown after Escape-dismiss when a recalled Input starts with `/`", async () => {
    const { inputValue, frameText, typeText, pressKey, unmount } = setup()
    try {
      await until(() => inputValue() === "Type your message...")

      await typeText("/no")
      await until(() => frameText().includes("> /noop"))
      await pressKey("\r")
      await until(() => frameText().includes("noop done"))

      await typeText("/h")
      await until(() => frameText().includes("> /help"))
      await pressKey("\u001B")
      await until(() => !frameText().includes("> /help"))

      await pressKey("\u001B[A")
      await until(() => inputValue() === "/noop")
      await until(() => frameText().includes("> /noop"))

      await pressKey("\u001B[B")
      await until(() => frameText().includes("> /noop"))
      expect(inputValue()).toBe("/noop")
    } finally {
      unmount()
    }
  }, 30000)
})

describe("App welcome-first flow", () => {
  function createCommands(): Command[] {
    const registry = new CommandRegistry()
    registry.register(createHelpCommand(registry))
    registry.register(createHomeCommand())
    return registry.getAll()
  }

  function setup() {
    const capturedMessages: Message[][] = []
    const provider = createStubProvider(capturedMessages)
    const instance = render(
      <App
        provider={provider}
        tools={[]}
        context={{ projectPath: "/tmp/welcome-test" }}
        initialApiKey="test-key"
        commands={createCommands()}
      />,
    )

    async function typeAndSubmit(text: string): Promise<void> {
      for (const char of text) {
        instance.stdin.write(char)
        await new Promise((resolve) => setTimeout(resolve, 5))
      }
      instance.stdin.write("\r")
    }

    return { ...instance, capturedMessages, typeAndSubmit }
  }

  it("boots to the welcome screen instead of the chat panel when no session exists", async () => {
    const { lastFrame, unmount } = setup()
    try {
      await until(() => (lastFrame() ?? "").includes("AI-Powered Coding Assistant"))
      const frame = lastFrame() ?? ""
      expect(frame).toContain("New Chat")
      expect(frame).toContain("███████╗")
      expect(frame).toContain("Ask anything or select an option...")
      expect(frame).not.toContain("Type your message")
    } finally {
      unmount()
    }
  })

  it("typing a first message on the welcome screen sends it and opens the chat", async () => {
    const { lastFrame, capturedMessages, typeAndSubmit, unmount } = setup()
    try {
      await until(() => (lastFrame() ?? "").includes("AI-Powered Coding Assistant"))

      await typeAndSubmit("hello from home")

      await until(() => (lastFrame() ?? "").includes("You:"))
      const frame = lastFrame() ?? ""
      expect(frame).toContain("hello from home")
      expect(frame).toContain("Type your message")
      expect(capturedMessages.length).toBeGreaterThan(0)
    } finally {
      unmount()
    }
  })

  it("returns to the welcome screen via /home and can start a new message there", async () => {
    const { lastFrame, capturedMessages, typeAndSubmit, stdin, unmount } = setup()
    try {
      await until(() => (lastFrame() ?? "").includes("AI-Powered Coding Assistant"))

      stdin.write("\r")
      await until(() => (lastFrame() ?? "").includes("Type your message"))

      await until(() => (lastFrame() ?? "").includes("Ready"))
      await typeAndSubmit("/home")
      await until(() => (lastFrame() ?? "").includes("AI-Powered Coding Assistant"))

      expect(lastFrame() ?? "").not.toContain("Type your message")

      await typeAndSubmit("back again")
      await until(() => (lastFrame() ?? "").includes("You:"))
      expect(lastFrame() ?? "").toContain("back again")
      expect(capturedMessages.length).toBeGreaterThan(0)
    } finally {
      unmount()
    }
  }, 15000)
})

describe("Welcome screen mouse-byte immunity", () => {
  function setup() {
    const instance = render(
      <App
        provider={createStubProvider([])}
        tools={[]}
        context={{ projectPath: "/tmp/welcome-mouse-test" }}
        initialApiKey="test-key"
        commands={createTestCommands()}
      />,
    )
    const frameText = () =>
      (instance.lastFrame() ?? "")
        .replace(/\u001B\[[0-9;]*m/g, "")
        .replace(/\s+/g, " ")
    return { ...instance, frameText }
  }

  it("ignores X10 and SGR clicks without leaking junk into the input box", async () => {
    const { frameText, stdin, unmount } = setup()
    try {
      await until(() => frameText().includes("AI-Powered Coding Assistant"))

      stdin.write("\u001B[M !!")
      await new Promise((r) => setTimeout(r, 20))
      stdin.write("\x1B[M")
      await new Promise((r) => setTimeout(r, 20))
      stdin.write("&")
      await new Promise((r) => setTimeout(r, 20))
      stdin.write("\u001B[<0;10;5M")
      await new Promise((r) => setTimeout(r, 50))

      expect(frameText()).not.toContain("!")
      expect(frameText()).not.toContain("&")
      expect(frameText()).not.toMatch(/<\d+;\d+;\d+M/)

      for (const char of "hello") {
        stdin.write(char)
        await new Promise((r) => setTimeout(r, 5))
      }
      expect(frameText()).toContain("hello")
      expect(frameText()).not.toMatch(/<\d+;\d+;\d+M/)
    } finally {
      unmount()
    }
  }, 15000)
})

describe("Welcome screen New Chat", () => {
  function makeSeedSession(): Session {
    return {
      id: "sess_welcome_seed",
      model: "stub-model",
      messages: [
        { id: "msg_seed", role: "user", content: [{ type: "text", text: "hello seed conversation" }], timestamp: Date.now() },
      ],
      createdAt: "2025-01-15T10:30:00.000Z",
      updatedAt: "2025-01-15T10:35:00.000Z",
      totalTokens: 7,
      totalCost: 0.001,
    }
  }

  it("persists the current session and boots into a blank chat, matching /new semantics", async () => {
    const seed = makeSeedSession()
    const sessionsDir = mkdtempSync(join(tmpdir(), "vicode-welcome-new-test-"))
    saveSession(seed, sessionsDir)
    const capturedMessages: Message[][] = []
    const instance = render(
      <App
        provider={createStubProvider(capturedMessages)}
        tools={[]}
        context={{ projectPath: "/tmp/welcome-new-test" }}
        initialApiKey="test-key"
        initialSession={seed}
        initialView="home"
        sessionsDir={sessionsDir}
        commands={createTestCommands()}
      />,
    )
    const frameText = () =>
      (instance.lastFrame() ?? "")
        .replace(/\u001B\[[0-9;]*m/g, "")
        .replace(/\s+/g, " ")
    try {
      await until(() => frameText().includes("AI-Powered Coding Assistant"))
      const bootFrame = frameText()
      expect(bootFrame).toContain("Start a fresh conversation")
      expect(bootFrame).toContain("Resume Session")

      instance.stdin.write("\r")
      await until(() => frameText().includes("Type your message"), 10000)

      const frame = frameText()
      expect(frame).not.toContain("hello seed conversation")
      expect(frame).not.toContain("Resume Session")
      expect(frame).toContain("Tokens: 0")
      expect(frame).toContain("$0.00")
      expect(existsSync(join(sessionsDir, "sess_welcome_seed.json"))).toBe(true)
    } finally {
      instance.unmount()
      rmSync(sessionsDir, { recursive: true, force: true })
    }
  }, 15000)
})

describe("Welcome screen word deletion", () => {
  function setup() {
    const instance = render(
      <App
        provider={createStubProvider([])}
        tools={[]}
        context={{ projectPath: "/tmp/welcome-wdel-test" }}
        initialApiKey="test-key"
        commands={createTestCommands()}
      />,
    )
    const frameText = () =>
      (instance.lastFrame() ?? "")
        .replace(/\u001B\[[0-9;]*m/g, "")
        .replace(/\s+/g, " ")
    return { ...instance, frameText }
  }

  it("Ctrl+Delete sequence deletes a word and BS deletes a single character", async () => {
    const { frameText, stdin, unmount } = setup()
    try {
      await until(() => frameText().includes("AI-Powered Coding Assistant"))

      for (const char of "hello beautiful world") {
        stdin.write(char)
        await new Promise((r) => setTimeout(r, 5))
      }
      expect(frameText()).toContain("hello beautiful world")

      stdin.write("\u001B[3;5~")
      await new Promise((r) => setTimeout(r, 50))
      expect(frameText()).toContain("hello beautiful")
      expect(frameText()).not.toContain("worl")
      expect(frameText()).not.toContain("world")

      stdin.write("\u0008")
      await new Promise((r) => setTimeout(r, 50))
      expect(frameText()).toContain("hello beautifu")
      expect(frameText()).not.toContain("beautiful")

      stdin.write("x")
      await new Promise((r) => setTimeout(r, 50))
      expect(frameText()).toContain("hello beautifux")
    } finally {
      unmount()
    }
  }, 15000)
})

describe("Welcome screen cursor-aware editing (whole-App seam)", () => {
  const LEFT = "\u001B[D"
  const RIGHT = "\u001B[C"
  const HOME = "\u001B[H"
  const END = "\u001B[F"
  const DELETE = "\u001B[3~"
  const BACKSPACE = "\u007F"
  const CTRL_W = "\u0017"

  function setup() {
    const instance = render(
      <App
        provider={createStubProvider([])}
        tools={[]}
        context={{ projectPath: "/tmp/welcome-cursor-seam-test" }}
        initialApiKey="test-key"
        commands={createTestCommands()}
      />,
    )
    const frameText = () =>
      (instance.lastFrame() ?? "")
        .replace(/\u001B\[[0-9;]*m/g, "")
        .replace(/\s+/g, " ")
    const boxLine = () =>
      (instance.lastFrame() ?? "")
        .replace(/\u001B\[[0-9;]*m/g, "")
        .split("\n")
        .find((l) => l.includes(ICONS.arrow)) ?? ""
    const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
    async function typeText(text: string) {
      for (const char of text) {
        instance.stdin.write(char)
        await sleep(5)
      }
    }
    async function pressKey(key: string) {
      instance.stdin.write(key)
      await sleep(15)
    }
    return { ...instance, frameText, boxLine, typeText, pressKey }
  }

  it("navigates by Left/Right, inserts at the Cursor, and sends the composed draft", async () => {
    const { frameText, boxLine, typeText, pressKey, stdin, unmount } = setup()
    try {
      await until(() => frameText().includes("AI-Powered Coding Assistant"))

      await typeText("hello")
      await pressKey(LEFT)
      await pressKey(LEFT)
      await pressKey(LEFT)
      await until(() => boxLine().includes("he llo"))

      await typeText("X")
      await until(() => boxLine().includes("heX llo"))

      stdin.write("\r")
      await until(() => frameText().includes("You: heXllo"), 10000)
    } finally {
      unmount()
    }
  }, 15000)

  it("pastes multi-character text at the Cursor", async () => {
    const { frameText, boxLine, typeText, pressKey, stdin, unmount } = setup()
    try {
      await until(() => frameText().includes("AI-Powered Coding Assistant"))

      await typeText("hello")
      await pressKey(LEFT)
      await pressKey(LEFT)
      await pressKey(LEFT)
      await until(() => boxLine().includes("he llo"))

      await pressKey("XY")
      await until(() => boxLine().includes("heXY llo"))

      stdin.write("\r")
      await until(() => frameText().includes("You: heXYllo"), 10000)
    } finally {
      unmount()
    }
  }, 15000)

  it("Home/End jump the Cursor to the start and end for insertion", async () => {
    const { frameText, boxLine, typeText, pressKey, stdin, unmount } = setup()
    try {
      await until(() => frameText().includes("AI-Powered Coding Assistant"))

      await typeText("abc")
      await pressKey(HOME)
      await until(() => boxLine().includes("→  abc"))

      await typeText("Z")
      await until(() => boxLine().includes("Z abc"))

      await pressKey(END)
      await pressKey("!")
      await until(() => boxLine().includes("Zabc!"))

      stdin.write("\r")
      await until(() => frameText().includes("You: Zabc!"), 10000)
    } finally {
      unmount()
    }
  }, 15000)

  it("Backspace removes before the Cursor, Delete removes under it, and Delete is a no-op at the end", async () => {
    const { frameText, boxLine, typeText, pressKey, stdin, unmount } = setup()
    try {
      await until(() => frameText().includes("AI-Powered Coding Assistant"))

      await typeText("abcdef")
      await pressKey(DELETE)
      await until(() => boxLine().includes("abcdef"))

      await pressKey(LEFT)
      await pressKey(LEFT)
      await pressKey(LEFT)
      await until(() => boxLine().includes("abc def"))

      await pressKey(BACKSPACE)
      await until(() => boxLine().includes("ab def"))

      await pressKey(RIGHT)
      await until(() => boxLine().includes("abd ef"))

      await pressKey(DELETE)
      await until(() => boxLine().includes("abd f"))

      stdin.write("\r")
      await until(() => frameText().includes("You: abdf"), 10000)
    } finally {
      unmount()
    }
  }, 15000)

  it("Ctrl+W word-deletes behind the Cursor, consuming the preceding whitespace at a boundary", async () => {
    const { frameText, boxLine, typeText, pressKey, stdin, unmount } = setup()
    try {
      await until(() => frameText().includes("AI-Powered Coding Assistant"))

      await typeText("one two three")
      await pressKey(CTRL_W)
      await until(() => !boxLine().includes("three"))
      expect(boxLine()).toContain("one two")

      stdin.write("\r")
      await until(() => frameText().includes("You: one two"), 10000)
      expect(frameText()).not.toContain("three")
    } finally {
      unmount()
    }
  }, 15000)

  it("moves over an emoji as one grapheme and backspaces it whole", async () => {
    const { frameText, boxLine, typeText, pressKey, stdin, unmount } = setup()
    try {
      await until(() => frameText().includes("AI-Powered Coding Assistant"))

      await typeText("a🚀b")
      await pressKey(LEFT)
      await until(() => boxLine().includes("a🚀 b"))

      await pressKey(BACKSPACE)
      await until(() => boxLine().includes("a b"))

      stdin.write("\r")
      await until(() => frameText().includes("You: ab"), 10000)
    } finally {
      unmount()
    }
  }, 15000)
})

describe("API key entry flow", () => {
  async function typeInto(instance: { stdin: { write: (s: string) => void } }, text: string): Promise<void> {
    for (const char of text) {
      instance.stdin.write(char)
      await new Promise((resolve) => setTimeout(resolve, 5))
    }
  }

  it("requires a key before chatting and streams once a key is entered", async () => {
    const captured: Message[][] = []
    const keysSeen: string[] = []
    const events: StreamEvent[] = [
      { type: "text-delta", text: "authed reply" },
      { type: "finish", usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2, cost: 0 } },
    ]
    const initial = createStubProvider([], events)
    const createProvider = (_modelId: string, apiKey = "") => {
      if (apiKey) keysSeen.push(apiKey)
      return createStubProvider(captured, events)
    }
    const savedKeys: string[] = []
    const instance = render(
      <App
        provider={initial}
        createProvider={createProvider}
        tools={[]}
        context={{ projectPath: "/tmp/key-flow-test" }}
        initialView="chat"
        commands={[...createTestCommands(), createKeyCommand()]}
        onSaveApiKey={(key) => {
          savedKeys.push(key)
        }}
      />,
    )
    const frameText = normalizeFrame(instance.lastFrame)
    try {
      await until(() => frameText().includes("Type your message"))

      await typeInto(instance, "hello without a key")
      instance.stdin.write("\r")
      await until(() => frameText().includes("OpenRouter API key required"))
      await new Promise((resolve) => setTimeout(resolve, 50))

      expect(captured).toHaveLength(0)
      expect(frameText()).not.toContain("hello without a key")

      await typeInto(instance, "sk-or-v1-testkey")
      instance.stdin.write("\r")
      await until(() => frameText().includes("authed reply"))

      expect(savedKeys).toEqual(["sk-or-v1-testkey"])
      expect(keysSeen).toEqual(["sk-or-v1-testkey"])
      expect(captured).toHaveLength(1)
      expect(JSON.stringify(captured[0])).toContain("hello without a key")
      expect(frameText()).not.toContain("OpenRouter API key")
    } finally {
      instance.unmount()
    }
  }, 30000)

  it("the /key command opens the key screen and Esc cancels without a key", async () => {
    const savedKeys: string[] = []
    const captured: Message[][] = []
    const instance = render(
      <App
        provider={createStubProvider(captured)}
        tools={[]}
        context={{ projectPath: "/tmp/key-cmd-test" }}
        initialView="chat"
        commands={[...createTestCommands(), createKeyCommand()]}
        onSaveApiKey={(key) => {
          savedKeys.push(key)
        }}
      />,
    )
    const frameText = normalizeFrame(instance.lastFrame)
    try {
      await until(() => frameText().includes("Type your message"))

      await typeInto(instance, "/key")
      instance.stdin.write("\r")
      await until(
        () => frameText().includes("OpenRouter API key") && !frameText().includes("required"),
      )

      instance.stdin.write("\u001B")
      await until(() => !frameText().includes("OpenRouter API key"))

      expect(savedKeys).toHaveLength(0)
      expect(captured).toHaveLength(0)
      expect(frameText()).toContain("Type your message")
    } finally {
      instance.unmount()
    }
  }, 30000)

  it("the /key remove command clears the saved key and the next chat requires it again", async () => {
    const captured: Message[][] = []
    const keysSeen: string[] = []
    const events: StreamEvent[] = [
      { type: "text-delta", text: "authed reply" },
      { type: "finish", usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2, cost: 0 } },
    ]
    const initial = createStubProvider([], events)
    const createProvider = (_modelId: string, apiKey = "") => {
      keysSeen.push(apiKey)
      return createStubProvider(captured, events)
    }
    const removed: string[] = []
    const instance = render(
      <App
        provider={initial}
        createProvider={createProvider}
        tools={[]}
        context={{ projectPath: "/tmp/key-remove-test" }}
        initialView="chat"
        initialApiKey="test-key"
        commands={[...createTestCommands(), createKeyCommand()]}
        onRemoveApiKey={() => {
          removed.push("removed")
        }}
      />,
    )
    const frameText = normalizeFrame(instance.lastFrame)
    try {
      await until(() => frameText().includes("Type your message"))

      await typeInto(instance, "/key remove")
      instance.stdin.write("\r")
      await until(() => frameText().includes("API key removed"))

      expect(removed).toHaveLength(1)

      await typeInto(instance, "hello after removal")
      instance.stdin.write("\r")
      await until(() => frameText().includes("OpenRouter API key required"))
      expect(captured).toHaveLength(0)
      expect(frameText()).not.toContain("hello after removal")
    } finally {
      instance.unmount()
    }
  }, 30000)

  it("centers the key entry screen on screen when shown", async () => {
    const instance = render(
      <App
        provider={createStubProvider([])}
        tools={[]}
        context={{ projectPath: "/tmp/key-center-test" }}
        initialView="chat"
        commands={[...createTestCommands(), createKeyCommand()]}
      />,
    )
    const frameLines = () =>
      (instance.lastFrame() ?? "")
        .replace(/\u001B\[[0-9;]*m/g, "")
        .split("\n")
    try {
      await until(() => (instance.lastFrame() ?? "").includes("Type your message"))

      for (const char of "/key") {
        instance.stdin.write(char)
        await new Promise((resolve) => setTimeout(resolve, 5))
      }
      instance.stdin.write("\r")
      await until(
        () =>
          frameLines().some((l) => l.includes("OpenRouter API key")) &&
          !(instance.lastFrame() ?? "").includes("required"),
      )

      const lines = frameLines()
      const titleRow = lines.findIndex((l) => l.includes("OpenRouter API key"))
      const bottomBorderRow = lines.findIndex((l) => l.includes("╰"))
      expect(titleRow).toBeGreaterThan(0)
      expect(titleRow).toBeLessThan(Math.floor(lines.length / 2))
      expect(bottomBorderRow).toBeGreaterThan(Math.floor(lines.length / 2))
      expect(bottomBorderRow).toBeGreaterThan(titleRow)
      expect(bottomBorderRow).toBeLessThan(lines.length - 1)
      expect(lines[titleRow]!.indexOf("OpenRouter API key")).toBeGreaterThan(3)
    } finally {
      instance.unmount()
    }
  }, 30000)
})

describe("Mode switching via Tab", () => {
  function setupModeSwitching(initialView: "home" | "chat" = "chat") {
    const projectDir = mkdtempSync(join(tmpdir(), "vicode-mode-"))
    mkdirSync(join(projectDir, ".vicode", "skills"), { recursive: true })
    writeFileSync(
      join(projectDir, ".vicode", "skills", "review-ritual.md"),
      "# Review Ritual\n\nAlways run the full suite before committing.",
    )
    const seen: Array<{ tools: string[]; prompt: string }> = []
    const provider: Provider = {
      getModelInfo: () => ({ id: "stub-model", name: "stub-model" }),
      async listModels() {
        return []
      },
      async *streamChat(_messages, tools, systemPrompt) {
        seen.push({ tools: tools.map((t) => t.name).sort(), prompt: systemPrompt })
        yield { type: "finish", usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2, cost: 0 } }
      },
    }
    const registry = new CommandRegistry()
    registry.register(createSkillCommand())
    const instance = render(
      <App
        provider={provider}
        tools={allTools}
        context={{ projectPath: projectDir }}
        initialApiKey="test-key"
        initialView={initialView}
        commands={registry.getAll()}
      />,
    )
    const frameText = normalizeFrame(instance.lastFrame)
    async function typeAndSubmit(text: string): Promise<void> {
      for (const char of text) {
        instance.stdin.write(char)
        await new Promise((resolve) => setTimeout(resolve, 5))
      }
      instance.stdin.write("\r")
      await new Promise((resolve) => setTimeout(resolve, 10))
    }
    async function pressTab(): Promise<void> {
      instance.stdin.write("\t")
      await new Promise((resolve) => setTimeout(resolve, 20))
    }
    async function pressEnter(): Promise<void> {
      instance.stdin.write("\r")
      await new Promise((resolve) => setTimeout(resolve, 30))
    }
    return { instance, seen, frameText, projectDir, typeAndSubmit, pressTab, pressEnter }
  }

  it("cycles build → discuss → plan and scopes the next submitted turn's tools and prompt", async () => {
    const { instance, seen, frameText, projectDir, typeAndSubmit, pressTab } = setupModeSwitching()
    try {
      await until(() => frameText().includes("Type your message"))

      await typeAndSubmit("first turn as build")
      await until(() => seen.length === 1)
      expect(seen[0]!.tools).toEqual(["bash", "edit_file", "list_files", "read_file", "search", "write_file"])
      expect(seen[0]!.prompt).toContain("build mode")

      await typeAndSubmit("/skill")
      await until(() => frameText().includes("Review Ritual"))
      for (let i = 0; i < 40 && !frameText().includes("Activated skill: Review Ritual"); i++) {
        instance.stdin.write("\r")
        await new Promise((resolve) => setTimeout(resolve, 50))
      }
      expect(frameText()).toContain("Activated skill: Review Ritual")

      await pressTab()
      await pressTab()
      await typeAndSubmit("plan this")
      await until(() => seen.length === 2)
      expect(seen[1]!.tools).toEqual(["list_files", "read_file", "search"])
      expect(seen[1]!.prompt).toContain("plan mode")
      expect(seen[1]!.prompt).not.toContain("write_file")
      expect(seen[1]!.prompt).not.toContain("edit_file")
      expect(seen[1]!.prompt).not.toContain("bash")
      expect(seen[1]!.prompt).toContain("# Review Ritual")
      expect(seen[1]!.prompt).toContain("Always run the full suite before committing")
      expect(seen[0]!.tools).toEqual(["bash", "edit_file", "list_files", "read_file", "search", "write_file"])

      await pressTab()
      await typeAndSubmit("build again")
      await until(() => seen.length === 3)
      expect(seen[2]!.tools).toEqual(["bash", "edit_file", "list_files", "read_file", "search", "write_file"])
      expect(seen[2]!.prompt).toContain("build mode")
      expect(seen[2]!.prompt).toContain("# Review Ritual")
    } finally {
      instance.unmount()
      rmSync(projectDir, { recursive: true, force: true })
    }
  }, 30000)

  it("cycles mode from the welcome screen's first-message box", async () => {
    const { instance, seen, frameText, projectDir, typeAndSubmit, pressTab } = setupModeSwitching("home")
    try {
      await until(() => frameText().includes("Ask anything or select an option"))

      await pressTab()

      await typeAndSubmit("hello from welcome")
      await until(() => seen.length === 1)
      expect(seen[0]!.tools).toEqual(["edit_file", "list_files", "read_file", "search", "write_file"])
      expect(seen[0]!.prompt).toContain("discuss mode")
    } finally {
      instance.unmount()
      rmSync(projectDir, { recursive: true, force: true })
    }
  }, 30000)

  it("renders the active mode in the status bar immediately on each Tab", async () => {
    const { instance, frameText, projectDir, pressTab } = setupModeSwitching()
    try {
      await until(() => frameText().includes("Type your message"))
      expect(frameText()).toContain("[Build]")

      await pressTab()
      await until(() => frameText().includes("[Discuss]"))

      await pressTab()
      await until(() => frameText().includes("[Plan]"))

      await pressTab()
      await until(() => frameText().includes("[Build]"))
    } finally {
      instance.unmount()
      rmSync(projectDir, { recursive: true, force: true })
    }
  }, 30000)

  it("renders the active mode on the welcome screen immediately on each Tab", async () => {
    const { instance, frameText, projectDir, pressTab } = setupModeSwitching("home")
    try {
      await until(() => frameText().includes("Ask anything or select an option"))
      expect(frameText()).toContain("[Build]")

      await pressTab()
      await until(() => frameText().includes("[Discuss]"))

      await pressTab()
      await until(() => frameText().includes("[Plan]"))
    } finally {
      instance.unmount()
      rmSync(projectDir, { recursive: true, force: true })
    }
  }, 30000)
})

describe("Mode persistence across sessions", () => {
  function makeSession(overrides?: Partial<Session>): Session {
    return {
      id: "sess_seed",
      model: "stub-model",
      messages: [
        { id: "msg_seed", role: "user", content: [{ type: "text", text: "seed question" }], timestamp: Date.now() },
      ],
      createdAt: "2025-01-15T10:30:00.000Z",
      updatedAt: "2025-01-15T10:35:00.000Z",
      totalTokens: 0,
      totalCost: 0,
      ...overrides,
    }
  }

  function setupPersistentMode(opts: { initialSession?: Session } = {}) {
    const projectDir = mkdtempSync(join(tmpdir(), "vicode-mode-persist-"))
    const sessionsDir = join(projectDir, ".vicode", "sessions")
    const seen: Array<{ tools: string[]; prompt: string }> = []
    const provider: Provider = {
      getModelInfo: () => ({ id: "stub-model", name: "stub-model" }),
      async listModels() {
        return []
      },
      async *streamChat(_messages, tools, systemPrompt) {
        seen.push({ tools: tools.map((t) => t.name).sort(), prompt: systemPrompt })
        yield { type: "finish", usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2, cost: 0 } }
      },
    }
    if (opts.initialSession) saveSession(opts.initialSession, sessionsDir)

    const registry = new CommandRegistry()
    registry.register(createHelpCommand(registry))
    registry.register(createNewCommand())
    registry.register(createSessionCommand())

    const instance = render(
      <App
        provider={provider}
        tools={allTools}
        context={{ projectPath: projectDir }}
        initialApiKey="test-key"
        initialSession={opts.initialSession}
        initialView="chat"
        sessionsDir={sessionsDir}
        commands={registry.getAll()}
      />,
    )
    const frameText = normalizeFrame(instance.lastFrame)
    async function typeAndSubmit(text: string): Promise<void> {
      for (const char of text) {
        instance.stdin.write(char)
        await new Promise((resolve) => setTimeout(resolve, 5))
      }
      instance.stdin.write("\r")
      await new Promise((resolve) => setTimeout(resolve, 10))
    }
    async function pressTab(): Promise<void> {
      instance.stdin.write("\t")
      await new Promise((resolve) => setTimeout(resolve, 20))
    }
    async function pressEnter(): Promise<void> {
      instance.stdin.write("\r")
      await new Promise((resolve) => setTimeout(resolve, 30))
    }
    function readSavedSessions(): Record<string, Session> {
      const result: Record<string, Session> = {}
      if (existsSync(sessionsDir)) {
        for (const file of readdirSync(sessionsDir).filter((f) => f.endsWith(".json"))) {
          const session = JSON.parse(readFileSync(join(sessionsDir, file), "utf-8")) as Session
          result[session.id] = session
        }
      }
      return result
    }
    function waitForSessionToContain(id: string, text: string): Promise<void> {
      return until(() => {
        if (!existsSync(join(sessionsDir, `${id}.json`))) return false
        return readFileSync(join(sessionsDir, `${id}.json`), "utf-8").includes(text)
      })
    }
    return {
      ...instance,
      seen,
      frameText,
      sessionsDir,
      projectDir,
      typeAndSubmit,
      pressTab,
      pressEnter,
      readSavedSessions,
      waitForSessionToContain,
    }
  }

  it("persists the active mode into the saved session on every turn", async () => {
    const { frameText, sessionsDir, typeAndSubmit, pressTab, readSavedSessions, unmount, projectDir } =
      setupPersistentMode()
    try {
      await until(() => frameText().includes("Type your message"))

      await typeAndSubmit("first turn")
      await until(() => {
        if (!existsSync(sessionsDir)) return false
        return readdirSync(sessionsDir).filter((f) => f.endsWith(".json")).length > 0
      })
      const firstId = Object.keys(readSavedSessions())[0]!
      expect(readSavedSessions()[firstId]!.mode).toBe("build")

      await pressTab()
      await until(() => frameText().includes("[Discuss]"))
      await typeAndSubmit("second turn")

      await until(() => {
        if (!existsSync(join(sessionsDir, `${firstId}.json`))) return false
        return readFileSync(join(sessionsDir, `${firstId}.json`), "utf-8").includes("second turn")
      })
      expect(readSavedSessions()[firstId]!.mode).toBe("discuss")
    } finally {
      unmount()
      rmSync(projectDir, { recursive: true, force: true })
    }
  }, 30000)

  it("restores a plan session's mode on resume and keeps the next turn read-only", async () => {
    const seed = makeSession({ id: "sess_plan", mode: "plan" })
    const { frameText, seen, typeAndSubmit, readSavedSessions, waitForSessionToContain, unmount, projectDir } =
      setupPersistentMode({ initialSession: seed })
    try {
      await until(() => frameText().includes("seed question"))
      expect(frameText()).toContain("[Plan]")

      await typeAndSubmit("follow up")
      await until(() => seen.length >= 1)
      expect(seen[0]!.tools).toEqual(["list_files", "read_file", "search"])
      expect(seen[0]!.prompt).toContain("plan mode")

      await waitForSessionToContain("sess_plan", "follow up")
      expect(readSavedSessions()["sess_plan"]!.mode).toBe("plan")
    } finally {
      unmount()
      rmSync(projectDir, { recursive: true, force: true })
    }
  }, 30000)

  it("restores the saved mode when switching sessions via /session", async () => {
    const plan = makeSession({ id: "sess_plan", mode: "plan", updatedAt: "2025-06-01T10:00:00.000Z" })
    const build = makeSession({ id: "sess_build", messages: [], updatedAt: "2025-01-01T10:00:00.000Z" })
    const { frameText, sessionsDir, typeAndSubmit, pressEnter, unmount, projectDir } = setupPersistentMode()
    try {
      await until(() => frameText().includes("Type your message"))
      expect(frameText()).toContain("[Build]")

      saveSession(plan, sessionsDir)
      saveSession(build, sessionsDir)

      await typeAndSubmit("/session")
      await until(() => frameText().includes("sess_plan"))
      await pressEnter()
      await until(() => frameText().includes("[Plan]"))
      expect(frameText()).toContain("seed question")
    } finally {
      unmount()
      rmSync(projectDir, { recursive: true, force: true })
    }
  }, 30000)

  it("/new resets the mode to build and the fresh session saves build", async () => {
    const seed = makeSession({ id: "sess_plan", mode: "plan" })
    const { frameText, typeAndSubmit, readSavedSessions, waitForSessionToContain, unmount, projectDir } =
      setupPersistentMode({ initialSession: seed })
    try {
      await until(() => frameText().includes("seed question"))
      expect(frameText()).toContain("[Plan]")

      await typeAndSubmit("/new")
      await until(() => frameText().includes("Started a new session"))
      expect(frameText()).toContain("[Build]")

      await typeAndSubmit("fresh turn")
      const freshId = await (async () => {
        await until(() => Object.keys(readSavedSessions()).some((id) => id !== "sess_plan"))
        return Object.keys(readSavedSessions()).find((id) => id !== "sess_plan")!
      })()
      await waitForSessionToContain(freshId, "fresh turn")
      expect(readSavedSessions()[freshId]!.mode).toBe("build")
    } finally {
      unmount()
      rmSync(projectDir, { recursive: true, force: true })
    }
  }, 30000)

  it("resumes a pre-mode session as build", async () => {
    const seed = makeSession({ id: "sess_legacy" })
    const { frameText, typeAndSubmit, readSavedSessions, waitForSessionToContain, unmount, projectDir } =
      setupPersistentMode({ initialSession: seed })
    try {
      await until(() => frameText().includes("seed question"))
      expect(frameText()).toContain("[Build]")

      await typeAndSubmit("legacy follow up")
      await waitForSessionToContain("sess_legacy", "legacy follow up")
      expect(readSavedSessions()["sess_legacy"]!.mode).toBe("build")
    } finally {
      unmount()
      rmSync(projectDir, { recursive: true, force: true })
    }
  }, 30000)
})
