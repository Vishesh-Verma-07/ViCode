import { describe, it, expect } from "bun:test"
import { createHomeCommand } from "@/commands/home"
import type { CommandContext } from "@/core/types"

function createContext(): {
  context: CommandContext
  homeRequests: number[]
} {
  const homeRequests: number[] = []
  return {
    homeRequests,
    context: {
      projectPath: "/tmp/project",
      navigation: {
        home: () => {
          homeRequests.push(Date.now())
        },
      },
    },
  }
}

describe("createHomeCommand", () => {
  it("is named home with a description", () => {
    const command = createHomeCommand()
    expect(command.name).toBe("home")
    expect(typeof command.description).toBe("string")
    expect(command.description.length).toBeGreaterThan(0)
  })

  it("navigates home through the capability", async () => {
    const { context, homeRequests } = createContext()

    const output = await createHomeCommand().execute([], context)

    expect(homeRequests).toHaveLength(1)
    expect(output).toBe("")
  })

  it("throws a helpful error when the navigation capability is missing", async () => {
    await expect(createHomeCommand().execute([], { projectPath: "/tmp/project" })).rejects.toThrow(/interactive/)
  })
})