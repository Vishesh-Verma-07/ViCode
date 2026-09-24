import { describe, it, expect, beforeEach, afterEach } from "bun:test"
import { mkdtempSync, rmSync, existsSync, readFileSync } from "fs"
import { join } from "path"
import { tmpdir } from "os"
import {
  getSessionsDir,
  saveSession,
  loadSession,
  listSessions,
  deleteSession,
  createSession,
  loadLatestSession,
  type Session,
} from "@/core/session"
import type { Message } from "@/core/types"

let tempDir: string

function makeMessage(overrides?: Partial<Message>): Message {
  return {
    id: "msg_1",
    role: "user",
    content: [{ type: "text", text: "hello" }],
    timestamp: Date.now(),
    ...overrides,
  }
}

function makeSession(overrides?: Partial<Session>): Session {
  return {
    id: "sess_abc123",
    model: "anthropic/claude-sonnet-4",
    messages: [makeMessage()],
    createdAt: "2025-01-15T10:30:00.000Z",
    updatedAt: "2025-01-15T10:35:00.000Z",
    totalTokens: 100,
    totalCost: 0.005,
    ...overrides,
  }
}

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "vicode-session-test-"))
})

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true })
})

describe("getSessionsDir", () => {
  it("resolves to the project-local .vicode/sessions directory", () => {
    const dir = getSessionsDir(tempDir)
    expect(dir).toBe(join(tempDir, ".vicode", "sessions"))
  })
})

describe("saveSession and loadSession", () => {
  it("saves a session to <project>/.vicode/sessions/<id>.json and loads it back", () => {
    const session = makeSession({ id: "sess_abc123" })
    const sessionsDir = getSessionsDir(tempDir)

    saveSession(session, sessionsDir)

    const filePath = join(tempDir, ".vicode", "sessions", "sess_abc123.json")
    expect(existsSync(filePath)).toBe(true)
    const saved = JSON.parse(readFileSync(filePath, "utf-8"))
    expect(saved.id).toBe(session.id)
    expect(saved).not.toHaveProperty("projectPath")

    const loaded = loadSession(session.id, sessionsDir)
    expect(loaded).not.toBeNull()
    expect(loaded!.id).toBe(session.id)
    expect(loaded).not.toHaveProperty("projectPath")
    expect(loaded!.model).toBe(session.model)
    expect(loaded!.messages).toHaveLength(1)
    expect(loaded!.totalTokens).toBe(100)
    expect(loaded!.totalCost).toBe(0.005)
  })

  it("creates the sessions directory if it does not exist", () => {
    const sessionsDir = join(tempDir, "nonexistent", "sessions")
    const session = makeSession({})

    saveSession(session, sessionsDir)

    expect(existsSync(sessionsDir)).toBe(true)
  })

  it("returns null for a non-existent session", () => {
    const sessionsDir = getSessionsDir(tempDir)
    const loaded = loadSession("nonexistent", sessionsDir)
    expect(loaded).toBeNull()
  })

  it("overwrites an existing session on save", () => {
    const sessionsDir = getSessionsDir(tempDir)
    const session = makeSession({ totalTokens: 100 })

    saveSession(session, sessionsDir)
    session.totalTokens = 200
    saveSession(session, sessionsDir)

    const loaded = loadSession(session.id, sessionsDir)
    expect(loaded!.totalTokens).toBe(200)
  })
})

describe("listSessions", () => {
  it("returns empty array when no sessions exist", () => {
    const sessionsDir = getSessionsDir(tempDir)
    const sessions = listSessions(sessionsDir)
    expect(sessions).toEqual([])
  })

  it("lists all saved sessions", () => {
    const sessionsDir = getSessionsDir(tempDir)
    const s1 = makeSession({ id: "s1", createdAt: "2025-01-15T10:00:00Z" })
    const s2 = makeSession({ id: "s2", createdAt: "2025-01-15T11:00:00Z" })

    saveSession(s1, sessionsDir)
    saveSession(s2, sessionsDir)

    const sessions = listSessions(sessionsDir)
    expect(sessions).toHaveLength(2)
    expect(sessions.map((s) => s.id)).toContain("s1")
    expect(sessions.map((s) => s.id)).toContain("s2")
  })

  it("returns sessions sorted by updatedAt descending", () => {
    const sessionsDir = getSessionsDir(tempDir)
    const s1 = makeSession({
      id: "s1",
      createdAt: "2025-01-15T10:00:00Z",
      updatedAt: "2025-01-15T10:00:00Z",
    })
    const s2 = makeSession({
      id: "s2",
      createdAt: "2025-01-15T10:00:00Z",
      updatedAt: "2025-01-15T11:00:00Z",
    })

    saveSession(s1, sessionsDir)
    saveSession(s2, sessionsDir)

    const sessions = listSessions(sessionsDir)
    expect(sessions[0]!.id).toBe("s2")
    expect(sessions[1]!.id).toBe("s1")
  })
})

describe("deleteSession", () => {
  it("deletes a saved session", () => {
    const sessionsDir = getSessionsDir(tempDir)
    const session = makeSession({})

    saveSession(session, sessionsDir)
    expect(loadSession(session.id, sessionsDir)).not.toBeNull()

    deleteSession(session.id, sessionsDir)
    expect(loadSession(session.id, sessionsDir)).toBeNull()
  })

  it("does not throw when deleting a non-existent session", () => {
    const sessionsDir = getSessionsDir(tempDir)
    expect(() => deleteSession("nonexistent", sessionsDir)).not.toThrow()
  })
})

describe("createSession", () => {
  it("creates a new session with defaults and no projectPath field", () => {
    const session = createSession({
      model: "anthropic/claude-sonnet-4",
    })

    expect(session.id).toMatch(/^sess_/)
    expect(session).not.toHaveProperty("projectPath")
    expect(session.model).toBe("anthropic/claude-sonnet-4")
    expect(session.messages).toEqual([])
    expect(session.totalTokens).toBe(0)
    expect(session.totalCost).toBe(0)
    expect(new Date(session.createdAt).getTime()).not.toBeNaN()
    expect(new Date(session.updatedAt).getTime()).not.toBeNaN()
  })
})

describe("loadLatestSession", () => {
  it("returns null when no sessions exist", () => {
    const result = loadLatestSession(tempDir)
    expect(result).toBeNull()
  })

  it("returns the most recently updated session", () => {
    const sessionsDir = getSessionsDir(tempDir)
    const s1 = makeSession({
      id: "s1",
      updatedAt: "2025-01-15T10:00:00Z",
    })
    const s2 = makeSession({
      id: "s2",
      updatedAt: "2025-01-15T11:00:00Z",
    })

    saveSession(s1, sessionsDir)
    saveSession(s2, sessionsDir)

    const result = loadLatestSession(tempDir)
    expect(result).not.toBeNull()
    expect(result!.id).toBe("s2")
  })
})