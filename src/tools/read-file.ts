import { z } from "zod"
import { readFileSync } from "fs"
import { resolve } from "path"
import type { ToolDefinition, ToolContext } from "../core/types"

export const readFileTool: ToolDefinition = {
  name: "read_file",
  description: "Read the contents of a file. Returns the file content as a string.",
  parameters: z.object({
    path: z.string().describe("File path relative to the project root"),
  }),
  dangerous: false,
  execute: async (args, context) => {
    const filePath = args.path as string
    const absPath = resolve(context.projectPath, filePath)

    if (!absPath.startsWith(context.projectPath)) {
      return "Error: path must be within the project directory"
    }

    try {
      return readFileSync(absPath, "utf-8")
    } catch (error) {
      return `Error: ${error instanceof Error ? error.message : String(error)}`
    }
  },
}
