import { z } from "zod"
import { spawnSync } from "child_process"
import type { ToolDefinition, ToolContext } from "../core/types"

export const bashTool: ToolDefinition = {
  name: "bash",
  description: "Execute a shell command and return its output. Use for running tests, builds, git commands, and other system operations.",
  parameters: z.object({
    command: z.string().describe("Shell command to execute"),
    cwd: z.string().optional().describe("Working directory (defaults to project root)"),
  }),
  dangerous: true,
  execute: async (args, context) => {
    const command = args.command as string
    const cwd = (args.cwd as string) || context.projectPath

    try {
      const result = spawnSync("bash", ["-c", command], {
        cwd,
        timeout: 30_000,
        maxBuffer: 1024 * 1024,
        encoding: "utf-8",
      })

      const parts: string[] = []
      if (result.stdout) parts.push(result.stdout)
      if (result.stderr) parts.push(result.stderr)

      if (parts.length === 0) {
        if (result.status !== 0) {
          return `Error: command exited with status ${result.status}`
        }
        return "(no output)"
      }

      if (result.status !== 0) {
        return `Error (exit ${result.status}):\n${parts.join("\n")}`
      }

      return parts.join("\n")
    } catch (error) {
      return `Error: ${error instanceof Error ? error.message : String(error)}`
    }
  },
}
