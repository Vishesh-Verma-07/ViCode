import { z } from "zod"
import { readFileSync } from "fs"
import { resolve } from "path"
import { pathRequiresApproval } from "../core/sensitive-files"
import type { ToolDefinition, ToolContext } from "../core/types"

export const readFileTool: ToolDefinition = {
  name: "read_file",
  description: "Read the contents of a file. Returns the file content as a string.",
  parameters: z.object({
    path: z.string().describe("File path relative to the project root"),
  }),
  dangerous: false,
  requiresApproval: pathRequiresApproval,
  execute: async (args, context) => {
    const filePath = args.path as string
    const absPath = resolve(context.projectPath, filePath)

    try {
      return readFileSync(absPath, "utf-8")
    } catch (error) {
      return `Error: ${error instanceof Error ? error.message : String(error)}`
    }
  },
}
