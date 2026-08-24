import { z } from "zod"
import { writeFileSync, mkdirSync, readFileSync } from "fs"
import { resolve, dirname } from "path"
import { createTwoFilesPatch } from "diff"
import { DIFF_START_MARKER, DIFF_END_MARKER } from "../core/constants"
import { isSensitivePath } from "../core/sensitive-files"
import type { ToolDefinition, ToolContext } from "../core/types"

export const writeFileTool: ToolDefinition = {
  name: "write_file",
  description: "Write content to a file. Creates the file and any parent directories if they don't exist. Overwrites existing files.",
  parameters: z.object({
    path: z.string().describe("File path relative to the project root"),
    content: z.string().describe("Content to write to the file"),
  }),
  dangerous: true,
  requiresApproval: (args, context: ToolContext) =>
    isSensitivePath(args.path as string, context.sensitivePatterns),
  execute: async (args, context) => {
    const filePath = args.path as string
    const content = args.content as string
    const absPath = resolve(context.projectPath, filePath)

    if (!absPath.startsWith(context.projectPath)) {
      return "Error: path must be within the project directory"
    }

    try {
      let oldContent = ""
      try {
        oldContent = readFileSync(absPath, "utf-8")
      } catch {
        // File doesn't exist yet
      }
      mkdirSync(dirname(absPath), { recursive: true })
      writeFileSync(absPath, content, "utf-8")
      if (oldContent) {
        const diff = createTwoFilesPatch(filePath, filePath, oldContent, content)
        return `File written successfully: ${filePath}\n${DIFF_START_MARKER}\n${diff}${DIFF_END_MARKER}`
      }
      return `File written successfully: ${filePath}`
    } catch (error) {
      return `Error: ${error instanceof Error ? error.message : String(error)}`
    }
  },
}
