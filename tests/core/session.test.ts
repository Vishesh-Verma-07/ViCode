import { describe, it, expect, beforeEach, afterEach } from "bun:test"
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync, mkdirSync } from "fs"
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
  renameSession,
  type Session,
} from "@/core/session"
import { QUALIFIED_MODEL_FORMAT_VERSION } from "@/core/model-id"
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
    version: QUALIFIED_MODEL_FORMAT_VERSION,
    messages: [makeMessage()],
    createdAt: "2025-01-15T10:30:00.000Z",
    updatedAt: "2025-01-15T10:35:00.000Z",
    totalTokens: 100,
    totalCost: 0.005,
    ...overrides,
  }
}

/** A session as written before provider qualification: no version marker. */
function makeLegacySessionFile(model: string, id = "sess_legacy"): void {
  const sessionsDir = getSessionsDir(tempDir)
  mkdirSync(sessionsDir, { recursive: true })
  writeFileSync(
    join(tempDir, ".vicode", "sessions", `${id}.json`),
    JSON.stringify({
      id,
      model,
      messages: [makeMessage()],
      createdAt: "2025-01-15T10:30:00.000Z",
      updatedAt: "2025-01-15T10:35:00.000Z",
      totalTokens: 100,
      totalCost: 0.005,
    }),
    "utf-8",
  )
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

  it("round-trips the session's mode on save and load", () => {
    const session = makeSession({ id: "sess_plan", mode: "plan" })
    const sessionsDir = getSessionsDir(tempDir)

    saveSession(session, sessionsDir)

    const loaded = loadSession("sess_plan", sessionsDir)
    expect(loaded).not.toBeNull()
    expect(loaded!.mode).toBe("plan")
  })

  it("resolves a session without a mode field to build on load", () => {
    const session = makeSession({ id: "sess_old" })
    const sessionsDir = getSessionsDir(tempDir)

    saveSession(session, sessionsDir)

    const loaded = loadSession("sess_old", sessionsDir)
    expect(loaded).not.toBeNull()
    expect(loaded!.mode).toBe("build")
  })

  it("resolves an invalid stored mode value to build on load", () => {
    const session = makeSession({ id: "sess_corrupt" })
    const sessionsDir = getSessionsDir(tempDir)
    saveSession(session, sessionsDir)

    const filePath = join(sessionsDir, "sess_corrupt.json")
    const raw = JSON.parse(readFileSync(filePath, "utf-8")) as Record<string, unknown>
    writeFileSync(filePath, JSON.stringify({ ...raw, mode: "turbo" }), "utf-8")

    const loaded = loadSession("sess_corrupt", sessionsDir)
    expect(loaded).not.toBeNull()
    expect(loaded!.mode).toBe("build")
  })

  it("resolves a non-string stored name to undefined on load", () => {
    const sessionsDir = getSessionsDir(tempDir)
    saveSession(makeSession({ id: "sess_badname" }), sessionsDir)
    const filePath = join(sessionsDir, "sess_badname.json")
    const raw = JSON.parse(readFileSync(filePath, "utf-8")) as Record<string, unknown>
    writeFileSync(filePath, JSON.stringify({ ...raw, name: { evil: true } }), "utf-8")

    const loaded = loadSession("sess_badname", sessionsDir)
    expect(loaded).not.toBeNull()
    expect(loaded!.name).toBeUndefined()
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

describe("pre-qualification model migration", () => {
  it("prefixes a legacy bare id with openrouter", () => {
    makeLegacySessionFile("nvidia/nemotron-3-ultra-550b-a55b:free")
    const loaded = loadSession("sess_legacy", getSessionsDir(tempDir))
    expect(loaded!.model).toBe("openrouter/nvidia/nemotron-3-ultra-550b-a55b:free")
  })

  it("keeps an existing session on OpenRouter when its id looks like a Provider", () => {
    // The collision: read as a Provider id this would become `openai/gpt-4o` on
    // the OpenAI Provider, moving the conversation and the bill.
    makeLegacySessionFile("openai/gpt-4o")
    const loaded = loadSession("sess_legacy", getSessionsDir(tempDir))
    expect(loaded!.model).toBe("openrouter/openai/gpt-4o")
  })

  it("keeps an existing Anthropic session on OpenRouter", () => {
    makeLegacySessionFile("anthropic/claude-sonnet-4")
    const loaded = loadSession("sess_legacy", getSessionsDir(tempDir))
    expect(loaded!.model).toBe("openrouter/anthropic/claude-sonnet-4")
  })

  it("stamps the current version on load so the migration is not repeated", () => {
    makeLegacySessionFile("openai/gpt-4o")
    expect(loadSession("sess_legacy", getSessionsDir(tempDir))!.version).toBe(
      QUALIFIED_MODEL_FORMAT_VERSION,
    )
  })

  it("makes the migration durable on save", () => {
    makeLegacySessionFile("openai/gpt-4o")
    const sessionsDir = getSessionsDir(tempDir)
    const loaded = loadSession("sess_legacy", sessionsDir)!
    saveSession(loaded, sessionsDir)

    const onDisk = JSON.parse(
      readFileSync(join(sessionsDir, "sess_legacy.json"), "utf-8"),
    )
    expect(onDisk.model).toBe("openrouter/openai/gpt-4o")
    expect(onDisk.version).toBe(QUALIFIED_MODEL_FORMAT_VERSION)
  })

  it("does not re-prefix a migrated session on a second load", () => {
    makeLegacySessionFile("openai/gpt-4o")
    const sessionsDir = getSessionsDir(tempDir)
    saveSession(loadSession("sess_legacy", sessionsDir)!, sessionsDir)
    expect(loadSession("sess_legacy", sessionsDir)!.model).toBe("openrouter/openai/gpt-4o")
  })

  it("reads a current-format Provider id as that Provider", () => {
    const sessionsDir = getSessionsDir(tempDir)
    mkdirSync(sessionsDir, { recursive: true })
    writeFileSync(
      join(sessionsDir, "sess_current.json"),
      JSON.stringify({
        id: "sess_current",
        version: QUALIFIED_MODEL_FORMAT_VERSION,
        model: "openai/gpt-5.3-codex",
        messages: [],
        createdAt: "2025-01-15T10:30:00.000Z",
        updatedAt: "2025-01-15T10:30:00.000Z",
        totalTokens: 0,
        totalCost: 0,
      }),
      "utf-8",
    )
    expect(loadSession("sess_current", sessionsDir)!.model).toBe("openai/gpt-5.3-codex")
  })

  it("stamps the version when creating a session", () => {
    const session = createSession({ model: "anthropic/claude-opus-5-5" })
    expect(session.version).toBe(QUALIFIED_MODEL_FORMAT_VERSION)
    expect(session.model).toBe("anthropic/claude-opus-5-5")
  })

  it("migrates model ids in the session list", () => {
    makeLegacySessionFile("openai/gpt-4o")
    const summaries = listSessions(getSessionsDir(tempDir))
    expect(summaries[0]!.model).toBe("openrouter/openai/gpt-4o")
  })
})

describe("renameSession", () => {
  it("returns a copy carrying the new name and leaves the original untouched", () => {
    const session = makeSession()

    const renamed = renameSession(session, "Refactor the parser")

    expect(renamed.name).toBe("Refactor the parser")
    expect(session).not.toHaveProperty("name")
    expect(renamed).not.toBe(session)
  })

  it("keeps every other field of the session intact", () => {
    const session = makeSession({ id: "sess_keep", mode: "plan", totalTokens: 42 })

    const renamed = renameSession(session, "Planning work")

    expect(renamed).toEqual({ ...session, name: "Planning work" })
    expect(renamed.updatedAt).toBe(session.updatedAt)
  })

  it("removes the name entirely when given null", () => {
    const session = makeSession({ name: "Old Name" })

    const renamed = renameSession(session, null)

    expect(renamed).not.toHaveProperty("name")
  })

  it("replaces an existing name rather than appending to it", () => {
    const session = makeSession({ name: "Old Name" })

    const renamed = renameSession(session, "New Name")

    expect(renamed.name).toBe("New Name")
  })

  it("treats an empty name the same as no name, matching how it is read back", () => {
    const session = makeSession({ name: "Old Name" })

    const renamed = renameSession(session, "")

    expect(renamed).not.toHaveProperty("name")
  })

  it("round-trips a name through save and load", () => {
    const sessionsDir = getSessionsDir(tempDir)

    saveSession(renameSession(makeSession({ id: "sess_named" }), "Deep work"), sessionsDir)

    const loaded = loadSession("sess_named", sessionsDir)
    expect(loaded!.name).toBe("Deep work")
  })

  it("drops the name from the saved file when cleared", () => {
    const sessionsDir = getSessionsDir(tempDir)
    saveSession(makeSession({ id: "sess_unnamed", name: "Temporary" }), sessionsDir)

    saveSession(renameSession(loadSession("sess_unnamed", sessionsDir)!, null), sessionsDir)

    const raw = readFileSync(join(sessionsDir, "sess_unnamed.json"), "utf-8")
    expect(raw).not.toContain("Temporary")
    expect(loadSession("sess_unnamed", sessionsDir)!.name).toBeUndefined()
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

  it("surfaces the session name and leaves it undefined when unnamed", () => {
    const sessionsDir = getSessionsDir(tempDir)

    saveSession(makeSession({ id: "s1", name: "Named one" }), sessionsDir)
    saveSession(makeSession({ id: "s2" }), sessionsDir)

    const sessions = listSessions(sessionsDir)
    expect(sessions.find((s) => s.id === "s1")!.name).toBe("Named one")
    expect(sessions.find((s) => s.id === "s2")!.name).toBeUndefined()
  })

  it("ignores a non-string stored name", () => {
    const sessionsDir = getSessionsDir(tempDir)
    saveSession(makeSession({ id: "s1" }), sessionsDir)
    const filePath = join(sessionsDir, "s1.json")
    const raw = JSON.parse(readFileSync(filePath, "utf-8")) as Record<string, unknown>
    writeFileSync(filePath, JSON.stringify({ ...raw, name: 42 }), "utf-8")

    expect(listSessions(sessionsDir)[0]!.name).toBeUndefined()
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
    expect(session.mode).toBe("build")
  })

  it("creates a new session with an explicit mode", () => {
    const session = createSession({
      model: "anthropic/claude-sonnet-4",
      mode: "discuss",
    })

    expect(session.mode).toBe("discuss")
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