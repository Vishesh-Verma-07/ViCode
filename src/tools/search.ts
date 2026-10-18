import { z } from "zod"
import { readFileSync } from "fs"
import { relative } from "path"
import { isSensitivePath } from "../core/sensitive-files"
import { collectProjectFiles } from "../core/project-files"
import type { ToolDefinition, ToolContext } from "../core/types"

export const searchTool: ToolDefinition = {
  name: "search",
  description:
    "Search across project files using a regex pattern. Returns matching lines with file paths and line numbers.",
  parameters: z.object({
    query: z.string().describe("Regex pattern to search for"),
  }),
  dangerous: false,
  execute: async (args, context) => {
    const pattern = args.query as string
    const projectPath = context.projectPath

    let regex: RegExp
    try {
      regex = new RegExp(pattern)
    } catch (error) {
      return `Error: Invalid regex pattern "${pattern}": ${error instanceof Error ? error.message : String(error)}`
    }

    try {
      const files = collectProjectFiles(projectPath)
      const results: string[] = []

      for (const filePath of files) {
        const relPath = relative(projectPath, filePath).replace(/\\/g, "/")
        if (isSensitivePath(relPath, context.sensitivePatterns)) continue
        let content: string
        try {
          content = readFileSync(filePath, "utf-8")
        } catch {
          continue
        }

        const lines = content.split("\n")
        for (let i = 0; i < lines.length; i++) {
          if (regex.test(lines[i]!)) {
            results.push(`${relPath}:${i + 1}: ${lines[i]!.trim()}`)
          }
        }
      }

      if (results.length === 0) return "No matches found"
      return results.join("\n")
    } catch (error) {
      return `Error: ${error instanceof Error ? error.message : String(error)}`
    }
  },
}
