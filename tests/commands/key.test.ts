import { describe, it, expect } from "bun:test"
import { createKeyCommand } from "@/commands/key"
import type { CommandContext } from "@/core/types"

function createContext(opts: { set?: () => Promise<boolean>; remove?: () => Promise<boolean> }) {
  const calls: string[] = []
  const context: CommandContext = {
    projectPath: "/tmp",
    key: {
      set: async () => {
        calls.push("set")
        return opts.set ? opts.set() : true
      },
      remove: async () => {
        calls.push("remove")
        return opts.remove ? opts.remove() : true
      },
    },
  }
  return { context, calls }
}

describe("key command", () => {
  it("opens the key set screen with no arguments", async () => {
    const { context, calls } = createContext({})
    const output = await createKeyCommand().execute([], context)
    expect(calls).toEqual(["set"])
    expect(output).toContain("API key saved")
  })

  it("removes the key with the remove subcommand", async () => {
    const { context, calls } = createContext({})
    const output = await createKeyCommand().execute(["remove"], context)
    expect(calls).toEqual(["remove"])
    expect(output).toContain("removed")
  })

  it("accepts clear and delete as aliases for remove", async () => {
    for (const sub of ["clear", "delete"]) {
      const { context, calls } = createContext({})
      await createKeyCommand().execute([sub], context)
      expect(calls).toEqual(["remove"])
    }
  })

  it("reports when there is no key to remove", async () => {
    const { context } = createContext({ remove: async () => false })
    const output = await createKeyCommand().execute(["remove"], context)
    expect(output).toContain("No API key")
  })

  it("rejects when the key capability is unavailable", async () => {
    const cmd = createKeyCommand()
    await expect(cmd.execute([], { projectPath: "/tmp" })).rejects.toThrow(/interactive UI/)
  })
})