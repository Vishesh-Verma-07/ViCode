import { describe, it, expect, beforeEach, afterEach } from "bun:test"
import { mkdtempSync, rmSync, existsSync, readFileSync } from "fs"
import { join } from "path"
import { tmpdir } from "os"
import { createSessionCommand, formatSessionName, formatSessionMeta } from "@/commands/session"
import { saveSession, loadSession, type Session } from "@/core/session"
import type { CommandContext, PickerRequest } from "@/core/types"
import type { Message } from "@/core/types"

let tempDir: string

function makeMessage(text: string, overrides?: Partial<Message>): Message {
  return {
    id: `msg_${text.replace(/\s+/g, "_")}`,
    role: "user",
    content: [{ type: "text", text }],
    timestamp: Date.now(),
    ...overrides,
  }
}

function makeSession(overrides?: Partial<Session>): Session {
  return {
    id: "sess_abc123",
    model: "anthropic/claude-sonnet-4",
    messages: [makeMessage("hello")],
    createdAt: "2025-01-15T10:30:00.000Z",
    updatedAt: "2025-01-15T10:35:00.000Z",
    totalTokens: 100,
    totalCost: 0.005,
    ...overrides,
  }
}

function createContext(opts: {
  dir: string
  activeSession?: Session | null
  pickerResult: number | null
}): {
  context: CommandContext
  pickerRequests: PickerRequest[]
  switchedTo: Session[]
} {
  const pickerRequests: PickerRequest[] = []
  const switchedTo: Session[] = []
  const activeSession = opts.activeSession === undefined ? null : opts.activeSession
  return {
    pickerRequests,
    switchedTo,
    context: {
      projectPath: "/tmp/project",
      openPicker: async (request) => {
        pickerRequests.push(request)
        return opts.pickerResult
      },
      sessions: {
        dir: opts.dir,
        getActiveSession: () => activeSession,
        switchTo: (session) => switchedTo.push(session),
        startFresh: () => {},
        rename: () => {},
      },
    },
  }
}

/**
 * A context for the picker's own actions. `onPicker` runs while the picker is
 * open, which is where Ctrl+D and Ctrl+R land in the real UI, so a test can
 * drive a delete or rename before the picker resolves.
 */
function createActionContext(opts: {
  dir: string
  activeSession?: Session | null
  pickerResult?: number | null
  onPicker?: (request: PickerRequest) => void
}): {
  context: CommandContext
  pickerRequests: PickerRequest[]
  switchedTo: Session[]
  renameCalls: (string | null)[]
  freshCalls: () => number
} {
  const pickerRequests: PickerRequest[] = []
  const switchedTo: Session[] = []
  const renameCalls: (string | null)[] = []
  const activeSession = opts.activeSession ?? null
  let fresh = 0
  return {
    pickerRequests,
    switchedTo,
    renameCalls,
    freshCalls: () => fresh,
    context: {
      projectPath: "/tmp/project",
      openPicker: async (request) => {
        pickerRequests.push(request)
        opts.onPicker?.(request)
        return opts.pickerResult ?? null
      },
      sessions: {
        dir: opts.dir,
        getActiveSession: () => activeSession,
        switchTo: (session) => switchedTo.push(session),
        startFresh: () => {
          fresh += 1
        },
        rename: (name) => renameCalls.push(name),
      },
    },
  }
}

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "vicode-session-cmd-test-"))
})

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true })
})

describe("formatSessionMeta", () => {
  it("includes timestamp, message count and model", () => {
    const meta = formatSessionMeta({
      id: "s1",
      model: "m1",
      messageCount: 3,
      createdAt: "2025-01-15T10:30:00.000Z",
      updatedAt: "2025-01-15T10:35:00.000Z",
      totalTokens: 0,
      totalCost: 0,
    })
    expect(meta).toContain(new Date("2025-01-15T10:35:00.000Z").toLocaleString())
    expect(meta).toContain("3 messages")
    expect(meta).toContain("m1")
  })
})

describe("formatSessionName", () => {
  const summary = { id: "s1", model: "m1", messageCount: 0, createdAt: "", updatedAt: "", totalTokens: 0, totalCost: 0 }

  it("falls back to the id when the session has no name", () => {
    expect(formatSessionName(summary)).toBe("s1")
  })

  it("leads with the name and keeps the id alongside it when named", () => {
    const label = formatSessionName({ ...summary, name: "Deep work" })
    expect(label).toContain("Deep work")
    expect(label).toContain("s1")
    expect(label.indexOf("Deep work")).toBeLessThan(label.indexOf("s1"))
  })

  it("ignores an empty stored name", () => {
    expect(formatSessionName({ ...summary, name: "" })).toBe("s1")
  })
})

describe("createSessionCommand", () => {
  it("is named session with a description", () => {
    const command = createSessionCommand()
    expect(command.name).toBe("session")
    expect(typeof command.description).toBe("string")
    expect(command.description.length).toBeGreaterThan(0)
  })

  it("reports when there are no saved sessions without opening the picker", async () => {
    const command = createSessionCommand()
    const { context, pickerRequests, switchedTo } = createContext({ dir: tempDir, pickerResult: null })

    const output = await command.execute([], context)

    expect(output).toContain("No saved sessions")
    expect(pickerRequests).toHaveLength(0)
    expect(switchedTo).toHaveLength(0)
  })

  it("opens the picker with sessions ordered most-recent-first showing id, timestamp, count and model", async () => {
    const dir = tempDir
    saveSession(makeSession({ id: "older", model: "model-a", updatedAt: "2025-01-01T10:00:00.000Z" }), dir)
    saveSession(
      makeSession({
        id: "newer",
        model: "model-b",
        messages: [makeMessage("one"), makeMessage("two"), makeMessage("three")],
        updatedAt: "2025-06-01T10:00:00.000Z",
      }),
      dir,
    )
    const command = createSessionCommand()
    const { context, pickerRequests } = createContext({ dir, pickerResult: null })

    await command.execute([], context)

    expect(pickerRequests).toHaveLength(1)
    const request = pickerRequests[0]!
    expect(request.items.map((i) => i.label)).toEqual(["newer", "older"])
    expect(request.items[0]!.metadata).toContain(new Date("2025-06-01T10:00:00.000Z").toLocaleString())
    expect(request.items[0]!.metadata).toContain("3 messages")
    expect(request.items[0]!.metadata).toContain("model-b")
    expect(request.items[1]!.metadata).toContain("model-a")
  })

  it("tells the user how to name a session in the picker", async () => {
    const dir = tempDir
    saveSession(makeSession({ id: "unnamed" }), dir)
    const command = createSessionCommand()
    const { context, pickerRequests } = createContext({ dir, pickerResult: null })

    await command.execute([], context)

    expect(pickerRequests[0]!.hint).toContain("/rename")
  })

  it("labels named sessions with their name and shows the name when switching", async () => {
    const dir = tempDir
    saveSession(
      makeSession({ id: "named", name: "Deep work", updatedAt: "2025-06-01T10:00:00.000Z" }),
      dir,
    )
    saveSession(makeSession({ id: "plain", updatedAt: "2025-05-01T10:00:00.000Z" }), dir)
    const command = createSessionCommand()
    const { context, pickerRequests } = createContext({ dir, pickerResult: 0 })

    const output = await command.execute([], context)

    const request = pickerRequests[0]!
    expect(request.items[0]!.label).toContain("Deep work")
    expect(request.items[0]!.label).toContain("named")
    expect(request.items[1]!.label).toBe("plain")
    expect(output).toContain("Deep work")
  })

  it("saves the current session before switching, then loads the chosen conversation losslessly", async () => {
    const dir = tempDir
    const savedOnDisk = makeSession({
      id: "target",
      messages: [makeMessage("earlier question"), makeMessage("another one")],
      updatedAt: "2025-06-01T10:00:00.000Z",
    })
    saveSession(savedOnDisk, dir)

    const unsavedCurrent = makeSession({
      id: "current",
      messages: [makeMessage("draft conversation")],
      updatedAt: "2025-05-01T10:00:00.000Z",
    })
    expect(existsSync(join(dir, "current.json"))).toBe(false)

    const command = createSessionCommand()
    let currentFileExistedAtSwitchTime = false
    const { context, switchedTo } = createContext({
      dir,
      activeSession: unsavedCurrent,
      pickerResult: 0,
    })
    context.sessions!.switchTo = (session) => {
      currentFileExistedAtSwitchTime = existsSync(join(dir, "current.json"))
      switchedTo.push(session)
    }

    const output = await command.execute([], context)

    expect(currentFileExistedAtSwitchTime).toBe(true)
    const savedCurrent = loadSession("current", dir)
    expect(savedCurrent).not.toBeNull()
    expect(savedCurrent!.messages).toHaveLength(1)
    expect(JSON.stringify(savedCurrent!.messages)).toContain("draft conversation")

    expect(switchedTo).toHaveLength(1)
    expect(switchedTo[0]!.id).toBe("target")
    expect(switchedTo[0]!.messages).toHaveLength(2)
    expect(output).toContain("target")
  })

  it("changes nothing when the picker is cancelled", async () => {
    const dir = tempDir
    const target = makeSession({ id: "target", updatedAt: "2025-06-01T10:00:00.000Z" })
    saveSession(target, dir)
    const targetRawBefore = readFileSync(join(dir, "target.json"), "utf-8")

    const activeSession = makeSession({ id: "current", updatedAt: "2025-05-01T10:00:00.000Z" })
    const command = createSessionCommand()
    const { context, switchedTo } = createContext({
      dir,
      activeSession,
      pickerResult: null,
    })

    const output = await command.execute([], context)

    expect(output).toBe("")
    expect(switchedTo).toHaveLength(0)
    expect(existsSync(join(dir, "current.json"))).toBe(false)
    expect(readFileSync(join(dir, "target.json"), "utf-8")).toBe(targetRawBefore)
  })

  it("throws a helpful error when session capabilities are missing", async () => {
    const command = createSessionCommand()
    await expect(command.execute([], { projectPath: "/tmp/project" })).rejects.toThrow(/interactive/)
  })

  it("exposes delete and rename on the picker request", async () => {
    saveSession(makeSession({ id: "s1" }), tempDir)
    const { context, pickerRequests } = createContext({ dir: tempDir, pickerResult: null })

    await createSessionCommand().execute([], context)

    expect(typeof pickerRequests[0]!.onDelete).toBe("function")
    expect(typeof pickerRequests[0]!.onRename).toBe("function")
    expect(pickerRequests[0]!.hint).toContain("Ctrl+D")
    expect(pickerRequests[0]!.hint).toContain("Ctrl+R")
  })
})

describe("session delete and rename from the picker", () => {
  it("removes the deleted session's file", async () => {
    saveSession(makeSession({ id: "keep", updatedAt: "2025-06-01T10:00:00.000Z" }), tempDir)
    saveSession(makeSession({ id: "gone", updatedAt: "2025-05-01T10:00:00.000Z" }), tempDir)

    const { context } = createActionContext({
      dir: tempDir,
      pickerResult: null,
      onPicker: (request) => request.onDelete?.(request.items[1]!),
    })

    await createSessionCommand().execute([], context)

    expect(existsSync(join(tempDir, "gone.json"))).toBe(false)
    expect(existsSync(join(tempDir, "keep.json"))).toBe(true)
  })

  it("starts fresh when the deleted session is the live one", async () => {
    const active = makeSession({ id: "active" })
    saveSession(active, tempDir)

    const { context, freshCalls } = createActionContext({
      dir: tempDir,
      activeSession: active,
      pickerResult: null,
      onPicker: (request) => request.onDelete?.(request.items[0]!),
    })

    await createSessionCommand().execute([], context)

    expect(freshCalls()).toBe(1)
    expect(existsSync(join(tempDir, "active.json"))).toBe(false)
  })

  it("rewrites a stored session's name and returns its new label", async () => {
    saveSession(makeSession({ id: "s1", updatedAt: "2025-06-01T10:00:00.000Z" }), tempDir)

    let label: string | void = ""
    const { context, renameCalls } = createActionContext({
      dir: tempDir,
      pickerResult: null,
      onPicker: (request) => {
        label = request.onRename?.(request.items[0]!, "Deep work")
      },
    })

    await createSessionCommand().execute([], context)

    expect(loadSession("s1", tempDir)!.name).toBe("Deep work")
    expect(label).toContain("Deep work")
    expect(label).toContain("s1")
    // A non-active session is written straight to disk, not through the app.
    expect(renameCalls).toEqual([])
  })

  it("renames the live session through the sessions capability", async () => {
    const active = makeSession({ id: "active", name: "Old" })
    saveSession(active, tempDir)

    const { context, renameCalls } = createActionContext({
      dir: tempDir,
      activeSession: active,
      pickerResult: null,
      onPicker: (request) => request.onRename?.(request.items[0]!, "New name"),
    })

    await createSessionCommand().execute([], context)

    expect(renameCalls).toEqual(["New name"])
  })

  it("clears the name when the rename is emptied", async () => {
    saveSession(makeSession({ id: "named", name: "Old", updatedAt: "2025-06-01T10:00:00.000Z" }), tempDir)

    const { context } = createActionContext({
      dir: tempDir,
      pickerResult: null,
      onPicker: (request) => {
        request.onRename?.(request.items[0]!, "   ")
      },
    })

    await createSessionCommand().execute([], context)

    expect(loadSession("named", tempDir)!.name).toBeUndefined()
  })

  it("switches to the session that shifted up after a delete", async () => {
    saveSession(makeSession({ id: "newer", updatedAt: "2025-06-01T10:00:00.000Z" }), tempDir)
    saveSession(makeSession({ id: "older", updatedAt: "2025-01-01T10:00:00.000Z" }), tempDir)

    const { context, switchedTo } = createActionContext({
      dir: tempDir,
      pickerResult: 0,
      onPicker: (request) => request.onDelete?.(request.items[0]!),
    })

    const output = await createSessionCommand().execute([], context)

    expect(switchedTo.map((s) => s.id)).toEqual(["older"])
    expect(output).toContain("older")
  })
})
