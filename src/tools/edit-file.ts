import { z } from "zod"
import { readFileSync, writeFileSync } from "fs"
import { resolve } from "path"
import type { ToolDefinition, ToolContext } from "../core/types"

export const editFileTool: ToolDefinition = {
  name: "edit_file",
  description: "Edit a file by replacing occurrences of oldText with newText in a file. The oldText must exist in the file.",
  parameters: z.object({
    path: z.string().describe("File path relative to the project root"),
    oldText: z.string().describe("Exact text to find and replace"),
    newText: z.string().describe("Text to replace oldText with"),
  }),
  dangerous: true,
  execute: async (args, context) => {
    const filePath = args.path as string
    const oldText = args.oldText as string
    const newText = args.newText as string
    const absPath = resolve(context.projectPath, filePath)

    if (!absPath.startsWith(context.projectPath)) {
      return "Error: path must be within the project directory"
    }

    try {
      const content = readFileSync(absPath, "utf-8")
      if (!content.includes(oldText)) {
        return `Error: oldText not found in ${filePath}`
      }
      const updated = content.split(oldText).join(newText)
      writeFileSync(absPath, updated, "utf-8")
      return `File edited successfully: ${filePath}`
    } catch (error) {
      return `Error: ${error instanceof Error ? error.message : String(error)}`
    }
  },
}
