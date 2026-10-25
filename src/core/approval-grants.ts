import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs"
import { dirname, resolve } from "path"

/**
 * Consent attached to one exact command in one Project.
 *
 * Grants live outside the Project Root on purpose: `.vicode.json` is a file
 * meant to be committed, so a grant written there would travel to everyone who
 * clones the repo and let a project grant itself permission (ADR-0015).
 */
interface TrustFile {
  projects: Record<string, string[]>
}

function trustFilePath(): string {
  const override = process.env.VICODE_TRUST_FILE
  if (override && override.trim().length > 0) return override
  const home = process.env.HOME || process.env.USERPROFILE || ""
  return home ? `${home}/.vicode/trust.json` : ""
}

/**
 * The key a Project's grants are stored under. Case-insensitive on Windows,
 * where two spellings of one directory are one directory.
 */
function projectKey(projectPath: string): string {
  const resolved = resolve(projectPath)
  return process.platform === "win32" ? resolved.toLowerCase() : resolved
}

/**
 * One spelling for a command, so trailing spaces or a doubled space between
 * arguments do not defeat a grant the user just gave.
 */
export function normalizeCommand(command: string): string {
  return command.trim().replace(/\s+/g, " ")
}

function readTrustFile(path: string): TrustFile {
  try {
    const raw = readFileSync(path, "utf-8")
    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== "object") return { projects: {} }
    const projects = (parsed as { projects?: unknown }).projects
    if (!projects || typeof projects !== "object") return { projects: {} }
    const normalized: Record<string, string[]> = {}
    for (const [key, value] of Object.entries(projects as Record<string, unknown>)) {
      if (!Array.isArray(value)) continue
      normalized[key] = value.filter((entry): entry is string => typeof entry === "string")
    }
    return { projects: normalized }
  } catch {
    return { projects: {} }
  }
}

function writeTrustFile(path: string, trust: TrustFile): boolean {
  try {
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, JSON.stringify(trust, null, 2) + "\n", "utf-8")
    return true
  } catch {
    return false
  }
}

/**
 * Loads this Project's remembered commands once, at startup. The returned Set
 * is the live view the Agent Loop consults, so a grant given mid-Session takes
 * effect on the next call without a reload.
 */
export function loadCommandGrants(projectPath: string): Set<string> {
  const path = trustFilePath()
  if (!path || !existsSync(path)) return new Set()
  const stored = readTrustFile(path).projects[projectKey(projectPath)] ?? []
  return new Set(stored.map(normalizeCommand))
}

/**
 * Adds one exact command to the live Set and persists it. Best-effort: a
 * failed write leaves the grant in force for this Session and returns false,
 * so the caller can say it will not survive a restart.
 */
export function grantCommand(
  projectPath: string,
  command: string,
  live: Set<string>,
): boolean {
  const normalized = normalizeCommand(command)
  if (!normalized) return false
  live.add(normalized)

  const path = trustFilePath()
  if (!path) return false
  const trust = readTrustFile(path)
  const key = projectKey(projectPath)
  const existing = new Set(trust.projects[key] ?? [])
  existing.add(normalized)
  trust.projects[key] = [...existing].sort()
  return writeTrustFile(path, trust)
}

/** Removes one exact command from the live Set and from disk. */
export function revokeCommand(
  projectPath: string,
  command: string,
  live: Set<string>,
): boolean {
  const normalized = normalizeCommand(command)
  live.delete(normalized)

  const path = trustFilePath()
  if (!path) return false
  const trust = readTrustFile(path)
  const key = projectKey(projectPath)
  const remaining = (trust.projects[key] ?? []).filter((entry) => entry !== normalized)
  if (remaining.length > 0) {
    trust.projects[key] = remaining
  } else {
    delete trust.projects[key]
  }
  return writeTrustFile(path, trust)
}
