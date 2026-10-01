import { describe, it, expect } from "bun:test"
import { createRenameCommand } from "@/commands/rename"
import { MAX_SESSION_NAME_LENGTH } from "@/core/session"
import type { CommandContext, Session } from "@/core/types"

function makeSession(overrides?: Partial<Session>): Session {
  return {
    id: "sess_abc123",
    model: "anthropic/claude-sonnet-4",
    messages: [],
    createdAt: "2025-01-15T10:30:00.000Z",
    updatedAt: "2025-01-15T10:35:00.000Z",
    totalTokens: 0,
    totalCost: 0,
    ...overrides,
  }
}

function createContext(opts: { activeSession?: Session | null } = {}) {
  const renames: (string | null)[] = []
  const activeSession = "activeSession" in opts ? (opts.activeSession ?? null) : makeSession()
  const context: CommandContext = {
    projectPath: "/tmp/project",
    sessions: {
      dir: "/tmp/project/.vicode/sessions",
      getActiveSession: () => activeSession,
      switchTo: () => {},
      startFresh: () => {},
      rename: (name) => {
        renames.push(name)
        return undefined
      },
    },
  }
  return { context, renames }
}

describe("createRenameCommand", () => {
  it("is named rename with a description", () => {
    const command = createRenameCommand()
    expect(command.name).toBe("rename")
    expect(typeof command.description).toBe("string")
    expect(command.description.length).toBeGreaterThan(0)
  })

  it("renames the active session from the words that follow the command", async () => {
    const { context, renames } = createContext()
    const output = await createRenameCommand().execute(["Refactor", "the", "parser"], context)
    expect(renames).toEqual(["Refactor the parser"])
    expect(output).toContain('Renamed this session to "Refactor the parser"')
  })

  it("replaces an existing name instead of appending to it", async () => {
    const { context, renames } = createContext({ activeSession: makeSession({ name: "Old" }) })
    const output = await createRenameCommand().execute(["New"], context)
    expect(renames).toEqual(["New"])
    expect(output).toContain('"New"')
  })

  it("treats a clear alias as a name when it is followed by more words", async () => {
    const { context, renames } = createContext({ activeSession: makeSession({ name: "Old" }) })
    const output = await createRenameCommand().execute(["delete", "the", "parser"], context)
    expect(renames).toEqual(["delete the parser"])
    expect(output).toContain('"delete the parser"')
  })

  it("clears the name for clear, remove and delete when given on their own", async () => {
    for (const alias of ["clear", "remove", "delete"]) {
      const { context, renames } = createContext({ activeSession: makeSession({ name: "Old" }) })
      const output = await createRenameCommand().execute([alias], context)
      expect(renames).toEqual([null])
      expect(output).toContain("cleared")
    }
  })

  it("says so when there is no name to clear", async () => {
    const { context, renames } = createContext({ activeSession: makeSession() })
    const output = await createRenameCommand().execute(["clear"], context)
    expect(renames).toEqual([])
    expect(output).toContain("no name")
  })

  it("explains itself when called with no name and no clear alias", async () => {
    const { context, renames } = createContext()
    const output = await createRenameCommand().execute([], context)
    expect(renames).toEqual([])
    expect(output).toContain("/rename <name>")
    expect(output).toContain("/rename clear")
  })

  it("refuses to create an empty name from whitespace-only arguments", async () => {
    const { context, renames } = createContext()
    const output = await createRenameCommand().execute(["", "  "], context)
    expect(renames).toEqual([])
    expect(output).toContain("/rename <name>")
  })

  it("rejects a name longer than the limit rather than silently truncating it", async () => {
    const { context, renames } = createContext()
    const tooLong = "x".repeat(MAX_SESSION_NAME_LENGTH + 1)
    const output = await createRenameCommand().execute([tooLong], context)
    expect(renames).toEqual([])
    expect(output).toContain(String(MAX_SESSION_NAME_LENGTH))
  })

  it("accepts a name of exactly the limit", async () => {
    const { context, renames } = createContext()
    const exact = "x".repeat(MAX_SESSION_NAME_LENGTH)
    await createRenameCommand().execute([exact], context)
    expect(renames).toEqual([exact])
  })

  it("asks for a message first when no session exists yet", async () => {
    const { context, renames } = createContext({ activeSession: null })
    const output = await createRenameCommand().execute(["Work"], context)
    expect(renames).toEqual([])
    expect(output).toContain("No session to rename yet")
  })

  it("throws a helpful error when session capabilities are missing", async () => {
    const command = createRenameCommand()
    await expect(command.execute(["Work"], { projectPath: "/tmp/project" })).rejects.toThrow(
      /interactive/,
    )
  })
})
