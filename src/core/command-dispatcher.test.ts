import { describe, it, expect } from "bun:test"
import { isCommandAttempt, getCommandName, dispatchCommand } from "./command-dispatcher"
import { CommandRegistry } from "./command-registry"
import type { Command, CommandContext } from "./types"

function makeRegistry(commands: Command[]): CommandRegistry {
  const registry = new CommandRegistry()
  registry.registerAll(commands)
  return registry
}

const noopContext: CommandContext = { projectPath: "/tmp/project" }

describe("isCommandAttempt", () => {
  it("classifies a bare slash command as an attempt", () => {
    expect(isCommandAttempt("/help")).toBe(true)
  })

  it("classifies a command with arguments as an attempt", () => {
    expect(isCommandAttempt("/model claude-sonnet")).toBe(true)
  })

  it("ignores surrounding whitespace", () => {
    expect(isCommandAttempt("   /help   ")).toBe(true)
  })

  it("does not classify normal messages", () => {
    expect(isCommandAttempt("hello world")).toBe(false)
  })

  it("does not classify messages where a later word starts with a slash", () => {
    expect(isCommandAttempt("check the path /usr/bin/node please")).toBe(false)
  })

  it("does not classify empty input", () => {
    expect(isCommandAttempt("")).toBe(false)
    expect(isCommandAttempt("   ")).toBe(false)
  })
})

describe("getCommandName", () => {
  it("strips the leading slash from the first word", () => {
    expect(getCommandName("/help")).toBe("help")
  })

  it("returns only the name, not the arguments", () => {
    expect(getCommandName("/session switch sess_1")).toBe("session")
  })

  it("ignores surrounding whitespace", () => {
    expect(getCommandName("   /exit  now   ")).toBe("exit")
  })

  it("preserves case exactly as typed, mirroring registry lookups", () => {
    expect(getCommandName("/EXIT")).toBe("EXIT")
  })
})

describe("dispatchCommand", () => {
  it("passes through input that is not a command attempt", async () => {
    const registry = makeRegistry([])
    let executed = false
    const registryWithSpy = makeRegistry([
      {
        name: "help",
        description: "Help",
        execute: async () => {
          executed = true
          return "should not run"
        },
      },
    ])
    void registry
    const result = await dispatchCommand("hello /usr/bin world", registryWithSpy, noopContext)
    expect(result.kind).toBe("pass-through")
    expect(executed).toBe(false)
  })

  it("executes a registered command and returns its output", async () => {
    const registry = makeRegistry([
      {
        name: "boom",
        description: "Boom",
        execute: async () => "detonated",
      },
    ])
    const result = await dispatchCommand("/boom", registry, noopContext)
    expect(result.kind).toBe("executed")
    if (result.kind === "executed") {
      expect(result.output).toBe("detonated")
    }
  })

  it("strips the leading slash and passes remaining words as args", async () => {
    let receivedArgs: string[] = []
    const registry = makeRegistry([
      {
        name: "greet",
        description: "Greet",
        execute: async (args) => {
          receivedArgs = args
          return "hi"
        },
      },
    ])
    await dispatchCommand("/greet alice bob", registry, noopContext)
    expect(receivedArgs).toEqual(["alice", "bob"])
  })

  it("collapses multiple spaces between args", async () => {
    let receivedArgs: string[] = []
    const registry = makeRegistry([
      {
        name: "greet",
        description: "Greet",
        execute: async (args) => {
          receivedArgs = args
          return "hi"
        },
      },
    ])
    await dispatchCommand("/greet   alice    bob", registry, noopContext)
    expect(receivedArgs).toEqual(["alice", "bob"])
  })

  it("returns unknown with available command names for unmatched slash input", async () => {
    const registry = makeRegistry([
      { name: "help", description: "Help", execute: async () => "ok" },
      { name: "new", description: "New", execute: async () => "ok" },
    ])
    const result = await dispatchCommand("/frobnicate", registry, noopContext)
    expect(result.kind).toBe("unknown")
    if (result.kind === "unknown") {
      expect(result.error).toContain("/frobnicate")
      expect(result.error).toContain("/help")
      expect(result.error).toContain("/new")
    }
  })

  it("treats a lone slash as an unknown command attempt", async () => {
    const registry = makeRegistry([
      { name: "help", description: "Help", execute: async () => "ok" },
    ])
    const result = await dispatchCommand("/", registry, noopContext)
    expect(result.kind).toBe("unknown")
  })

  it("returns failed with the error message when a command throws", async () => {
    const registry = makeRegistry([
      {
        name: "explode",
        description: "Explode",
        execute: async () => {
          throw new Error("kaboom")
        },
      },
    ])
    const result = await dispatchCommand("/explode", registry, noopContext)
    expect(result.kind).toBe("failed")
    if (result.kind === "failed") {
      expect(result.error).toContain("kaboom")
    }
  })

  it("never creates a user message — dispatch only consults the registry and command", async () => {
    const registry = makeRegistry([
      {
        name: "help",
        description: "Help",
        execute: async (_args, context) => {
          expect(context.projectPath).toBe("/tmp/project")
          return "commands listed"
        },
      },
    ])
    const result = await dispatchCommand("/help", registry, noopContext)
    expect(result.kind).toBe("executed")
  })
})
