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
  const baseName = normalized.split("/").pop() ?? normalized
  const patterns = [...DEFAULT_SENSITIVE_PATTERNS, ...extraPatterns]

  for (const glob of patterns) {
    const regex = compilePattern(glob)
    if (glob.includes("/")) {
      if (regex.test(normalized)) return true
    } else if (regex.test(baseName) || regex.test(normalized)) {
      return true
    }
  }

  return false
}
