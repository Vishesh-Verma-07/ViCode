import { describe, it, expect, beforeEach, afterEach } from "bun:test"
import { mkdtempSync, rmSync, existsSync } from "fs"
import { join } from "path"
import { tmpdir } from "os"
import { createNewCommand } from "./new"
import { loadSession, type Session } from "../core/session"
import type { CommandContext, Message } from "../core/types"

let tempDir: string

function makeMessage(text: string): Message {
  return {
    id: `msg_${text.replace(/\s+/g, "_")}`,
    role: "user",
    content: [{ type: "text", text }],
    timestamp: Date.now(),
  }
}

function makeSession(overrides?: Partial<Session>): Session {
  return {
    id: "sess_current",
    projectPath: "/tmp/test",
    model: "anthropic/claude-sonnet-4",
    messages: [makeMessage("draft conversation")],
    createdAt: "2025-01-15T10:30:00.000Z",
    updatedAt: "2025-01-15T10:35:00.000Z",
    totalTokens: 100,
    totalCost: 0.005,
    ...overrides,
  }
}

function createContext(opts: { dir: string; activeSession?: Session | null }): {
  context: CommandContext
  freshStarts: number[]
} {
  const freshStarts: number[] = []
  const activeSession = opts.activeSession === undefined ? null : opts.activeSession
  return {
    freshStarts,
    context: {
      projectPath: "/tmp/project",
      sessions: {
        dir: opts.dir,
        getActiveSession: () => activeSession,
        switchTo: () => {},
        startFresh: () => freshStarts.push(Date.now()),
      },
    },
  }
}

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "vicode-new-cmd-test-"))
})

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true })
})

describe("createNewCommand", () => {
  it("is named new with a description", () => {
    const command = createNewCommand()
    expect(command.name).toBe("new")
    expect(typeof command.description).toBe("string")
    expect(command.description.length).toBeGreaterThan(0)
  })

  it("saves the current session so it stays resumable, then starts fresh", async () => {
    const dir = tempDir
    const active = makeSession()
    expect(existsSync(join(dir, "sess_current.json"))).toBe(false)

    let fileExistedAtFreshTime = false
    const { context, freshStarts } = createContext({ dir, activeSession: active })
    context.sessions!.startFresh = () => {
      fileExistedAtFreshTime = existsSync(join(dir, "sess_current.json"))
      freshStarts.push(Date.now())
    }

    const output = await createNewCommand().execute([], context)

    expect(fileExistedAtFreshTime).toBe(true)
    expect(freshStarts).toHaveLength(1)

    const saved = loadSession("sess_current", dir)
    expect(saved).not.toBeNull()
    expect(saved!.messages).toHaveLength(1)
    expect(JSON.stringify(saved!.messages)).toContain("draft conversation")

    expect(output).toContain("Started a new session")
  })

  it("starts fresh even when there is no active session yet", async () => {
    const { context, freshStarts } = createContext({ dir: tempDir, activeSession: null })

    const output = await createNewCommand().execute([], context)

    expect(freshStarts).toHaveLength(1)
    expect(output).toContain("Started a new session")
  })

  it("throws a helpful error when the sessions capability is missing", async () => {
    await expect(createNewCommand().execute([], { projectPath: "/tmp/project" })).rejects.toThrow(/\/new/)
  })
})
