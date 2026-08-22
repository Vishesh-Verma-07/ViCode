import React from "react"
import { describe, it, expect } from "bun:test"
import { mkdtempSync, existsSync, readFileSync, readdirSync, rmSync } from "fs"
import { tmpdir } from "os"
import { join } from "path"
import { EventEmitter } from "events"
import { render as inkRender } from "ink"
import { render } from "ink-testing-library"
import { App, FeedbackLine, STREAMING_COMMAND_NOTICE, extractDiff } from "./app"
import { CommandRegistry } from "../core/command-registry"
import { createHelpCommand } from "../commands/help"
import { createSessionCommand } from "../commands/session"
import { createNewCommand } from "../commands/new"
import { createExitCommand } from "../commands/exit"
import { saveSession, loadSession, type Session } from "../core/session"
import type { Command, Message, ToolDefinition } from "../core/types"
import type { Provider, StreamEvent } from "../core/provider"
import { z } from "zod"

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
  registry.register({
    name: "echo",
    description: "Echoes its arguments",
    execute: async (args) => args.join(" "),
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

describe("App command suggestion dropdown", () => {
  function setup() {
    const capturedMessages: Message[][] = []
    const provider = createStubProvider(capturedMessages)
    const instance = render(
      <App
        provider={provider}
        tools={[]}
        systemPrompt=""
        context={{ projectPath: "/tmp/suggestion-test" }}
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
      const statusBarIndex = frame.indexOf("Tokens:")
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
      projectPath: "/tmp/test",
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
        systemPrompt=""
        context={{ projectPath: join(sessionsDir, "project") }}
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
      expect(frameAfterNew).toContain("No diffs yet")
      expect(frameAfterNew).toContain("Tokens: 0")
      expect(frameAfterNew).toContain("$0.00")
      expect(existsSync(join(sessionsDir, "sess_seed_one.json"))).toBe(true)

      pressKey("\t")
      await until(() => (lastFrame() ?? "").includes("No tool calls yet"))

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
  })
})

describe("App /exit command", () => {
  function makeSeedSession(id: string): Session {
    return {
      id,
      projectPath: "/tmp/test",
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
        systemPrompt=""
        context={{ projectPath: join(sessionsDir, "project") }}
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
  })

  it("aborts an in-flight response via /exit, saves the conversation and exits", async () => {
    const capturedMessages: Message[][] = []
    let abortObserved = false
    const hangingProvider: Provider = {
      getModelInfo: () => ({ id: "stub-model", name: "stub-model" }),
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
  })
})

describe("App streaming guard for commands", () => {
  function setupGuarded() {
    const capturedMessages: Message[][] = []
    const hangingProvider: Provider = {
      getModelInfo: () => ({ id: "stub-model", name: "stub-model" }),
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
        systemPrompt=""
        context={{ projectPath: "/tmp/guard-test" }}
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
  })
})
