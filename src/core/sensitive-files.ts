import { resolve, relative } from "path"

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

export function pathRequiresApproval(
  args: Record<string, unknown>,
  context: { projectPath: string; sensitivePatterns?: string[] },
): boolean {
  const declared = args.path as string | undefined
  if (!declared) return true
  const absPath = resolve(context.projectPath, declared)
  if (!absPath.startsWith(context.projectPath)) return false
  const relPath = relative(context.projectPath, absPath)
  return isSensitivePath(relPath, context.sensitivePatterns)
}
