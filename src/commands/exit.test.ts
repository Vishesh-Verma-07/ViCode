import { describe, it, expect } from "bun:test"
import { createExitCommand } from "./exit"
import type { CommandContext } from "../core/types"

function createContext(): {
  context: CommandContext
  exitRequests: number[]
} {
  const exitRequests: number[] = []
  return {
    exitRequests,
    context: {
      projectPath: "/tmp/project",
      exit: {
        requestExit: async () => {
          exitRequests.push(Date.now())
        },
      },
    },
  }
}

describe("createExitCommand", () => {
  it("is named exit with a description", () => {
    const command = createExitCommand()
    expect(command.name).toBe("exit")
    expect(typeof command.description).toBe("string")
    expect(command.description.length).toBeGreaterThan(0)
  })

  it("requests an exit through the capability and awaits it", async () => {
    const { context, exitRequests } = createContext()

    const output = await createExitCommand().execute([], context)

    expect(exitRequests).toHaveLength(1)
    expect(output).toBe("")
  })

  it("throws a helpful error when the exit capability is missing", async () => {
    await expect(createExitCommand().execute([], { projectPath: "/tmp/project" })).rejects.toThrow(/interactive/)
  })
})
