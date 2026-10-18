/**
 * The tree every read-only sweep of the project walks.
 *
 * `search` and the File Mention index both want "the project's text files",
 * so the ignore set and the binary exclusion live here rather than drifting
 * between two walkers that disagree about what counts as a project file.
 */
import { readdirSync } from "fs"
import { join, extname } from "path"

export const IGNORED_DIRS = new Set(["node_modules", ".git", "dist", "build", "__pycache__"])

const BINARY_EXTENSIONS = new Set([
  ".png", ".jpg", ".jpeg", ".gif", ".bmp", ".ico", ".webp",
  ".mp3", ".mp4", ".wav", ".avi", ".mov",
  ".zip", ".tar", ".gz", ".rar", ".7z",
  ".exe", ".dll", ".so", ".dylib",
  ".woff", ".woff2", ".ttf", ".eot",
  ".pdf", ".bin",
])

export function isBinaryPath(filePath: string): boolean {
  return BINARY_EXTENSIONS.has(extname(filePath).toLowerCase())
}

/**
 * Every text file under `projectPath`, as absolute paths, skipping ignored
 * directories and binaries. Throws when a directory cannot be read — the
 * caller decides whether that is an error worth reporting (`search`) or a
 * tree not worth showing (the File Mention index).
 */
export function collectProjectFiles(projectPath: string): string[] {
  const results: string[] = []
  const walk = (dir: string): void => {
    const entries = readdirSync(dir, { withFileTypes: true })
    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (IGNORED_DIRS.has(entry.name)) continue
        walk(join(dir, entry.name))
      } else if (!isBinaryPath(entry.name)) {
        results.push(join(dir, entry.name))
      }
    }
  }
  walk(projectPath)
  return results
}
