import { describe, it, expect } from "bun:test"
import { createKeyCommand } from "@/commands/key"
import type { CommandContext } from "@/core/types"
import type { ProviderId } from "@/core/providers"

function createContext(opts: {
  set?: () => Promise<boolean>
  remove?: () => Promise<boolean>
  activeProvider?: ProviderId
}) {
  const set: ProviderId[] = []
  const remove: ProviderId[] = []
  const context: CommandContext = {
    projectPath: "/tmp",
    models: {
      listProviders: async () => [],
      getCurrentModelId: () => "openrouter/gpt-4o",
      getCurrentProvider: () => opts.activeProvider ?? "openrouter",
      switchTo: () => {},
    },
    key: {
      set: async (provider) => {
        set.push(provider ?? "openrouter")
        return opts.set ? opts.set() : true
      },
      remove: async (provider) => {
        remove.push(provider ?? "openrouter")
        return opts.remove ? opts.remove() : true
      },
    },
  }
  return { context, set, remove }
}

describe("key command", () => {
  it("opens the key set screen for the active Provider by default", async () => {
    const { context, set } = createContext({})
    const output = await createKeyCommand().execute([], context)
    expect(set).toEqual(["openrouter"])
    expect(output).toContain("OpenRouter")
    expect(output).toContain("Saved")
  })

  it("defaults to the Providers capability when there is no models capability", async () => {
    const { set } = createContext({})
    const context: CommandContext = {
      projectPath: "/tmp",
      providers: {
        list: async () => [],
        getCurrent: () => "anthropic",
        switchTo: async () => null,
      },
      key: {
        set: async (provider) => {
          set.push(provider ?? "openrouter")
          return true
        },
        remove: async () => true,
      },
    }
    await createKeyCommand().execute([], context)
    expect(set).toEqual(["anthropic"])
  })

  it("targets a Provider named as an argument", async () => {
    const { context, set } = createContext({})
    const output = await createKeyCommand().execute(["opencode-go"], context)
    expect(set).toEqual(["opencode-go"])
    expect(output).toContain("OpenCode Go")
  })

  it("rejects an unknown Provider and lists the valid ones", async () => {
    const { context, set } = createContext({})
    const output = await createKeyCommand().execute(["nope"], context)
    expect(output).toContain('Unknown provider "nope"')
    expect(output).toContain("openrouter")
    expect(output).toContain("opencode-go")
    expect(set).toHaveLength(0)
  })

  it("removes the active Provider's key with the remove subcommand", async () => {
    const { context, remove } = createContext({})
    const output = await createKeyCommand().execute(["remove"], context)
    expect(remove).toEqual(["openrouter"])
    expect(output).toContain("Removed")
    expect(output).toContain("OpenRouter")
  })

  it("accepts clear and delete as aliases for remove", async () => {
    for (const sub of ["clear", "delete"]) {
      const { context, remove } = createContext({})
      await createKeyCommand().execute([sub], context)
      expect(remove).toEqual(["openrouter"])
    }
  })

  it("combines a Provider with a remove subcommand", async () => {
    const { context, remove } = createContext({})
    await createKeyCommand().execute(["anthropic", "remove"], context)
    expect(remove).toEqual(["anthropic"])
  })

  it("reports when there is no key to remove", async () => {
    const { context } = createContext({ remove: async () => false })
    const output = await createKeyCommand().execute(["remove"], context)
    expect(output).toContain("No OpenRouter API key")
  })

  it("reports an unchanged key", async () => {
    const { context } = createContext({ set: async () => false })
    const output = await createKeyCommand().execute([], context)
    expect(output).toContain("unchanged")
  })

  it("names every Provider in its description", () => {
    const description = createKeyCommand().description
    for (const id of ["openrouter", "openai", "anthropic", "opencode", "opencode-go"]) {
      expect(description).toContain(id)
    }
  })

  it("rejects when the key capability is unavailable", async () => {
    const cmd = createKeyCommand()
    await expect(cmd.execute([], { projectPath: "/tmp" })).rejects.toThrow(/interactive UI/)
  })
})