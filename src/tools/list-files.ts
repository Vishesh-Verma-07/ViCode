import { z } from "zod"
import { readdirSync } from "fs"
import { resolve, join, relative } from "path"
import type { ToolDefinition, ToolContext } from "../core/types"

function globMatch(name: string, pattern: string): boolean {
  const regexStr =
    "^" +
    pattern
      .replace(/\./g, "\\.")
      .replace(/\*/g, ".*")
      .replace(/\?/g, ".")
      .replace(/\{([^}]+)\}/g, (_, group: string) => `(${group.split(",").join("|")})`) +
    "$"
  return new RegExp(regexStr).test(name)
}

export const listFilesTool: ToolDefinition = {
  name: "list_files",
  description:
    "List directory contents. Use a path like '.' for the project root, or a glob pattern like '*.ts' to filter.",
  parameters: z.object({
    path: z.string().describe("Directory path or glob pattern relative to the project root"),
  }),
  dangerous: false,
  execute: async (args, context) => {
    const inputPath = args.path as string
    const projectPath = context.projectPath

    try {
      const hasGlob = inputPath.includes("*") || inputPath.includes("?")

      if (hasGlob) {
        let searchDir = projectPath
        let pattern: string | null = inputPath

        const starIndex = inputPath.indexOf("*")
        const slashBeforeStar = inputPath.lastIndexOf("/", starIndex - 1)
        if (slashBeforeStar >= 0) {
          searchDir = resolve(projectPath, inputPath.slice(0, slashBeforeStar))
          pattern = inputPath.slice(slashBeforeStar + 1)
        } else {
          pattern = inputPath
        }

        const entries = readdirSync(searchDir, { withFileTypes: true })
        const matches = entries
          .filter((e) => globMatch(e.name, pattern!))
          .map((e) => {
            const rel = relative(projectPath, join(searchDir, e.name)).replace(/\\/g, "/")
            return e.isDirectory() ? `${rel}/` : rel
          })

        if (matches.length === 0) return "No matches found"
        return matches.join("\n")
      }

      const absPath = resolve(projectPath, inputPath)
      if (!absPath.startsWith(projectPath)) {
        return "Error: path must be within the project directory"
      }

      const entries = readdirSync(absPath, { withFileTypes: true })
      const lines = entries.map((e) => (e.isDirectory() ? `${e.name}/` : e.name))
      return lines.join("\n")
    } catch (error) {
      return `Error: ${error instanceof Error ? error.message : String(error)}`
    }
  },
}
