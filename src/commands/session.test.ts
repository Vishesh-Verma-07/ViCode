import { describe, it, expect, beforeEach, afterEach } from "bun:test"
import { mkdtempSync, rmSync, existsSync, readFileSync } from "fs"
import { join } from "path"
import { tmpdir } from "os"
import { createSessionCommand, formatSessionMeta } from "./session"
import { saveSession, loadSession, type Session } from "../core/session"
import type { CommandContext, PickerRequest } from "../core/types"
import type { Message } from "../core/types"

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
    projectPath: "/tmp/test",
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
})
