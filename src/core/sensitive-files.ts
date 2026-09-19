import { resolve, relative, sep } from "path"
import type { ToolContext } from "./types"

export const DEFAULT_SENSITIVE_PATTERNS = [
  ".env",
  ".env.*",
  "*.pem",
  "*.key",
  "id_rsa*",
  ".git-credentials",
  ".ssh/**",
]

function globToRegex(glob: string): RegExp {
  let source = ""
  for (let i = 0; i < glob.length; i++) {
    const char = glob[i]!
    if (char === "*") {
      if (glob[i + 1] === "*") {
        source += ".*"
        i++
      } else {
        source += "[^/]*"
      }
    } else if ("\\^$.|?+()[]{}".includes(char)) {
      source += `\\${char}`
    } else {
      source += char
    }
  }
  return new RegExp(`^(?:.*/)?${source}$`)
}

const patternCache = new Map<string, RegExp>()

function compilePattern(glob: string): RegExp {
  let regex = patternCache.get(glob)
  if (!regex) {
    regex = globToRegex(glob)
    patternCache.set(glob, regex)
  }
  return regex
}

export function isSensitivePath(relativePath: string, extraPatterns: string[] = []): boolean {
  const normalized = relativePath.replace(/\\/g, "/")
  const patterns = [...DEFAULT_SENSITIVE_PATTERNS, ...extraPatterns]

  for (const glob of patterns) {
    if (compilePattern(glob).test(normalized)) return true
  }

  return false
}

export function isInsideProject(absPath: string, projectPath: string): boolean {
  return absPath === projectPath || absPath.startsWith(projectPath + sep)
}

export function resolveInsideProject(declared: string, projectPath: string): string | null {
  const root = resolve(projectPath)
  const absPath = resolve(root, declared)
  if (!isInsideProject(absPath, root)) return null
  return relative(root, absPath)
}

const FILE_TOOLS = ["read_file", "write_file", "edit_file"]

export function fileToolApprovalKey(
  toolName: string,
  args: Record<string, unknown>,
  projectPath: string,
): string | null {
  if (!FILE_TOOLS.includes(toolName)) return null
  const declared = args.path
  if (typeof declared !== "string" || declared.trim().length === 0) return null
  return resolve(projectPath, declared)
}

export function pathRequiresApproval(
  args: Record<string, unknown>,
  context: Pick<ToolContext, "projectPath" | "sensitivePatterns">,
): boolean {
  const declared = args.path as string | undefined
  if (!declared) return true
  const relPath = resolveInsideProject(declared, context.projectPath)
  if (relPath === null) return true
  return isSensitivePath(relPath, context.sensitivePatterns)
}
