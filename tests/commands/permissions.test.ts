import { describe, it, expect } from "bun:test"
import { createPermissionsCommand } from "@/commands/permissions"
import type { CommandContext, PermissionEntry, PickerRequest } from "@/core/types"

function createContext(entries: PermissionEntry[]): {
  context: CommandContext
  pickerRequests: PickerRequest[]
  revoked: PermissionEntry[]
} {
  const pickerRequests: PickerRequest[] = []
  const revoked: PermissionEntry[] = []
  const live = [...entries]
  return {
    pickerRequests,
    revoked,
    context: {
      projectPath: "/tmp/project",
      openPicker: async (request) => {
        pickerRequests.push(request)
        return null
      },
      permissions: {
        list: () => live,
        revoke: (entry) => {
          revoked.push(entry)
          const index = live.indexOf(entry)
          if (index >= 0) live.splice(index, 1)
        },
      },
    },
  }
}

describe("/permissions", () => {
  it("says so when nothing has been approved", async () => {
    const command = createPermissionsCommand()
    const output = await command.execute([], createContext([]).context)
    expect(output).toBe("No saved approvals for this project.")
  })

  it("lists command grants and session paths together", async () => {
    const { context, pickerRequests } = createContext([
      { kind: "command", value: "docker compose up --build -d" },
      { kind: "path", value: "/tmp/project/.env" },
    ])
    await createPermissionsCommand().execute([], context)

    const request = pickerRequests[0]!
    expect(request.items.map((item) => item.label)).toEqual([
      "docker compose up --build -d",
      "/tmp/project/.env",
    ])
    expect(request.items[0]!.metadata).toContain("command")
    expect(request.items[1]!.metadata).toContain("path")
  })

  it("revokes the highlighted entry through Ctrl+D", async () => {
    const entry: PermissionEntry = { kind: "command", value: "npm publish" }
    const { context, pickerRequests, revoked } = createContext([entry])
    await createPermissionsCommand().execute([], context)

    const request = pickerRequests[0]!
    request.onDelete!(request.items[0]!)

    expect(revoked).toEqual([entry])
  })

  it("requires an interactive UI", async () => {
    const command = createPermissionsCommand()
    await expect(
      command.execute([], { projectPath: "/tmp/project" }),
    ).rejects.toThrow("requires an interactive UI")
  })
})
