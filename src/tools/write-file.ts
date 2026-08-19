import { z } from "zod"
import { writeFileSync, mkdirSync } from "fs"
import { resolve, dirname } from "path"
import type { ToolDefinition, ToolContext } from "../core/types"

export const writeFileTool: ToolDefinition = {
  name: "write_file",
  description: "Write content to a file. Creates the file and any parent directories if they don't exist. Overwrites existing files.",
  parameters: z.object({
    path: z.string().describe("File path relative to the project root"),
    content: z.string().describe("Content to write to the file"),
  }),
  dangerous: true,
  execute: async (args, context) => {
    const filePath = args.path as string
    const content = args.content as string
    const absPath = resolve(context.projectPath, filePath)

    if (!absPath.startsWith(context.projectPath)) {
      return "Error: path must be within the project directory"
    }

    try {
      mkdirSync(dirname(absPath), { recursive: true })
      writeFileSync(absPath, content, "utf-8")
      return `File written successfully: ${filePath}`
    } catch (error) {
      return `Error: ${error instanceof Error ? error.message : String(error)}`
    }
  },
}
