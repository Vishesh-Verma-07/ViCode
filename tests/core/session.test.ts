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
    modelFormatVersion: QUALIFIED_MODEL_FORMAT_VERSION,
    messages: [makeMessage()],
    createdAt: "2025-01-15T10:30:00.000Z",
    updatedAt: "2025-01-15T10:35:00.000Z",
    totalTokens: 100,
    totalCost: 0.005,
    ...overrides,
  }
}

/** A session as written before provider qualification: no format marker. */
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

  it("keeps an unpriced session's total unknown across a save and load", () => {
    const sessionsDir = getSessionsDir(tempDir)
    saveSession(makeSession({ id: "sess_unpriced", totalCost: null }), sessionsDir)

    expect(JSON.parse(readFileSync(join(sessionsDir, "sess_unpriced.json"), "utf-8")).totalCost).toBeNull()
    expect(loadSession("sess_unpriced", sessionsDir)!.totalCost).toBeNull()
  })

  it("reads a stored total with no cost figure as unknown rather than leaving it undefined", () => {
    const sessionsDir = getSessionsDir(tempDir)
    mkdirSync(sessionsDir, { recursive: true })
    writeFileSync(
      join(sessionsDir, "sess_nocost.json"),
      JSON.stringify({
        id: "sess_nocost",
        model: "anthropic/claude-sonnet-4",
        messages: [],
        createdAt: "2025-01-15T10:30:00.000Z",
        updatedAt: "2025-01-15T10:35:00.000Z",
        totalTokens: 100,
      }),
      "utf-8",
    )

    expect(loadSession("sess_nocost", sessionsDir)!.totalCost).toBeNull()
    expect(listSessions(sessionsDir)[0]!.totalCost).toBeNull()
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

  it("writes back every field the current Session shape has, and no others", () => {
    // `saveSession` rebuilds the record field by field so a dropped field is not
    // carried forward. That makes a field added to `Session` and forgotten here
    // vanish on the next save, so the shape is asserted against the Session the
    // current code creates rather than a hand-written list of fields.
    const sessionsDir = getSessionsDir(tempDir)
    const session = createSession({ model: "anthropic/claude-opus-5-5", mode: "plan" })
    session.name = "Deep work"
    session.totalCost = null
    session.lastCompaction = { before: [], summary: "a summary", at: "2026-09-24T05:54:14.902Z" }

    saveSession(session, sessionsDir)

    const onDisk = JSON.parse(
      readFileSync(join(sessionsDir, `${session.id}.json`), "utf-8"),
    ) as Record<string, unknown>
    expect(Object.keys(onDisk).sort()).toEqual(Object.keys(session).sort())
  })
})

/**
 * A session exactly as the current release stamped it: marked under the old
 * field name, with an id that is already canonical. Reading it as unmarked would
 * move an Anthropic conversation onto OpenRouter — the misreading that names the
 * field (issue #86).
 */
function makeOldFieldNameSessionFile(
  id = "sess_oldfield",
  sessionsDir = getSessionsDir(tempDir),
): string {
  mkdirSync(sessionsDir, { recursive: true })
  const file = join(sessionsDir, `${id}.json`)
  writeFileSync(
    file,
    JSON.stringify({
      id,
      version: QUALIFIED_MODEL_FORMAT_VERSION,
      model: "anthropic/claude-opus-5-5",
      messages: [],
      createdAt: "2026-09-24T05:54:14.902Z",
      updatedAt: "2026-09-24T05:54:14.902Z",
      totalTokens: 0,
      totalCost: 0,
    }),
    "utf-8",
  )
  return file
}

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

  it("stamps the current format on load so the migration is not repeated", () => {
    makeLegacySessionFile("openai/gpt-4o")
    expect(
      loadSession("sess_legacy", getSessionsDir(tempDir))!.modelFormatVersion,
    ).toBe(QUALIFIED_MODEL_FORMAT_VERSION)
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
    expect(onDisk.modelFormatVersion).toBe(QUALIFIED_MODEL_FORMAT_VERSION)
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
        modelFormatVersion: QUALIFIED_MODEL_FORMAT_VERSION,
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

  it("stamps the format when creating a session", () => {
    const session = createSession({ model: "anthropic/claude-opus-5-5" })
    expect(session.modelFormatVersion).toBe(QUALIFIED_MODEL_FORMAT_VERSION)
    expect(session.model).toBe("anthropic/claude-opus-5-5")
  })

  it("reads a session written under the marker's original field name as current", () => {
    makeOldFieldNameSessionFile()

    expect(loadSession("sess_oldfield", getSessionsDir(tempDir))!.model).toBe(
      "anthropic/claude-opus-5-5",
    )
  })

  it("renames the marker on save when the session used the original field name", () => {
    const sessionsDir = getSessionsDir(tempDir)
    const file = makeOldFieldNameSessionFile("sess_oldfield", sessionsDir)

    saveSession(loadSession("sess_oldfield", sessionsDir)!, sessionsDir)

    const onDisk = JSON.parse(readFileSync(file, "utf-8")) as Record<string, unknown>
    expect(onDisk.modelFormatVersion).toBe(QUALIFIED_MODEL_FORMAT_VERSION)
    expect(onDisk.version).toBeUndefined()
  })

  it("reads a renamed session as current rather than legacy on the next load", () => {
    const sessionsDir = getSessionsDir(tempDir)
    makeOldFieldNameSessionFile("sess_roundtrip", sessionsDir)

    saveSession(loadSession("sess_roundtrip", sessionsDir)!, sessionsDir)

    expect(loadSession("sess_roundtrip", sessionsDir)!.model).toBe("anthropic/claude-opus-5-5")
    expect(
      (JSON.parse(readFileSync(join(sessionsDir, "sess_roundtrip.json"), "utf-8")) as Record<string, unknown>)
        .version,
    ).toBeUndefined()
  })

  it("migrates model ids in the session list", () => {
    makeLegacySessionFile("openai/gpt-4o")
    const summaries = listSessions(getSessionsDir(tempDir))
    expect(summaries[0]!.model).toBe("openrouter/openai/gpt-4o")
  })
})

describe("a session written before provider qualification", () => {
  /**
   * A real session file, copied from `.vicode/sessions/`, as ViCode wrote it
   * before the Providers existed: no version marker, a bare OpenRouter model
   * id, a folded summary, a compaction, and the `projectPath` field this
   * project later dropped. Only the path was changed, since the point of the
   * field is that it is a dead absolute path from another machine.
   */
  const LEGACY = join(import.meta.dir, "..", "fixtures", "legacy-session.json")

  function installLegacySession(): string {
    const sessionsDir = getSessionsDir(tempDir)
    mkdirSync(sessionsDir, { recursive: true })
    const legacy = JSON.parse(readFileSync(LEGACY, "utf-8")) as Session
    writeFileSync(join(sessionsDir, `${legacy.id}.json`), readFileSync(LEGACY, "utf-8"), "utf-8")
    return sessionsDir
  }

  it("loads a session whose file predates the current format", () => {
    const sessionsDir = installLegacySession()

    const loaded = loadSession("sess_1790133483114_com4bj", sessionsDir)

    expect(loaded).not.toBeNull()
    expect(loaded!.id).toBe("sess_1790133483114_com4bj")
    expect(loaded!.name).toBe("raju")
    expect(loaded!.messages).toHaveLength(5)
    expect(loaded!.totalTokens).toBe(6020)
  })

  it("qualifies the stored model id under the Provider that could have served it", () => {
    // Pre-qualification data is OpenRouter by definition: `nvidia/...` was a
    // maker prefix on that route, never a Provider.
    const sessionsDir = installLegacySession()

    expect(loadSession("sess_1790133483114_com4bj", sessionsDir)!.model).toBe(
      "openrouter/nvidia/nemotron-3-ultra-550b-a55b:free",
    )
  })

  it("keeps the folded summary and the compaction it folded", () => {
    const sessionsDir = installLegacySession()

    const loaded = loadSession("sess_1790133483114_com4bj", sessionsDir)!

    expect(loaded.messages[0]!.content[0]).toMatchObject({
      type: "context-summary",
      foldedMessages: 2,
      foldedTokens: 17,
    })
    expect(loaded.lastCompaction!.before).toHaveLength(2)
    expect(loaded.lastCompaction!.at).toBe("2026-09-24T05:54:14.902Z")
  })

  it("keeps the Mode and the name the older version already stored", () => {
    const sessionsDir = installLegacySession()

    const loaded = loadSession("sess_1790133483114_com4bj", sessionsDir)!

    expect(loaded.mode).toBe("build")
    expect(loaded.name).toBe("raju")
  })

  it("writes the session back in the current shape", () => {
    const sessionsDir = installLegacySession()
    const loaded = loadSession("sess_1790133483114_com4bj", sessionsDir)!

    saveSession(loaded, sessionsDir)

    const onDisk = JSON.parse(
      readFileSync(join(sessionsDir, `${loaded.id}.json`), "utf-8"),
    ) as Record<string, unknown>
    expect(onDisk.model).toBe("openrouter/nvidia/nemotron-3-ultra-550b-a55b:free")
    expect(onDisk.modelFormatVersion).toBe(QUALIFIED_MODEL_FORMAT_VERSION)
  })

  it("writes back no field the current shape has dropped", () => {
    // `projectPath` went when sessions moved into the project directory
    // (ADR-0002). The migration rebuilds the record field by field, so a field
    // dropped from `Session` is not carried forward forever — a dead absolute
    // path from whichever machine wrote it.
    const sessionsDir = installLegacySession()
    const loaded = loadSession("sess_1790133483114_com4bj", sessionsDir)!

    saveSession(loaded, sessionsDir)

    const onDisk = JSON.parse(
      readFileSync(join(sessionsDir, `${loaded.id}.json`), "utf-8"),
    ) as Record<string, unknown>
    const currentShape = new Set([
      ...Object.keys(createSession({ model: "anthropic/claude-opus-5-5" })),
      // Fields a Session may carry but a fresh one does not.
      "name",
      "lastCompaction",
    ])
    expect(Object.keys(onDisk).filter((key) => !currentShape.has(key))).toEqual([])
  })

  it("keeps the migrated shape stable across a second round trip", () => {
    const sessionsDir = installLegacySession()

    saveSession(loadSession("sess_1790133483114_com4bj", sessionsDir)!, sessionsDir)
    const first = readFileSync(join(sessionsDir, "sess_1790133483114_com4bj.json"), "utf-8")
    saveSession(loadSession("sess_1790133483114_com4bj", sessionsDir)!, sessionsDir)

    expect(readFileSync(join(sessionsDir, "sess_1790133483114_com4bj.json"), "utf-8")).toBe(first)
  })

  it("lists the migrated session under its qualified model id", () => {
    const sessionsDir = installLegacySession()

    const summaries = listSessions(sessionsDir)

    expect(summaries).toHaveLength(1)
    expect(summaries[0]).toMatchObject({
      id: "sess_1790133483114_com4bj",
      name: "raju",
      model: "openrouter/nvidia/nemotron-3-ultra-550b-a55b:free",
      messageCount: 5,
      totalTokens: 6020,
      totalCost: 0,
    })
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