import { z } from "zod"
import { readdirSync, readFileSync } from "fs"
import { join, relative, extname } from "path"
import type { ToolDefinition, ToolContext } from "../core/types"

const IGNORED_DIRS = new Set(["node_modules", ".git", "dist", "build", "__pycache__"])
const BINARY_EXTENSIONS = new Set([
  ".png", ".jpg", ".jpeg", ".gif", ".bmp", ".ico", ".webp",
  ".mp3", ".mp4", ".wav", ".avi", ".mov",
  ".zip", ".tar", ".gz", ".rar", ".7z",
  ".exe", ".dll", ".so", ".dylib",
  ".woff", ".woff2", ".ttf", ".eot",
  ".pdf", ".bin",
])

function isBinaryFile(filePath: string): boolean {
  return BINARY_EXTENSIONS.has(extname(filePath).toLowerCase())
}

function collectFiles(dir: string, projectPath: string): string[] {
  const results: string[] = []
  const entries = readdirSync(dir, { withFileTypes: true })
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (IGNORED_DIRS.has(entry.name)) continue
      results.push(...collectFiles(join(dir, entry.name), projectPath))
    } else {
      const absPath = join(dir, entry.name)
      if (!isBinaryFile(absPath)) {
        results.push(absPath)
      }
    }
  }
  return results
}

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
      const files = collectFiles(projectPath, projectPath)
      const results: string[] = []

      for (const filePath of files) {
        const relPath = relative(projectPath, filePath).replace(/\\/g, "/")
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
