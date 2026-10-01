import { mkdirSync, readFileSync, writeFileSync, existsSync, readdirSync, unlinkSync } from "fs"
import { join } from "path"
import type { Session } from "./types"
import { DEFAULT_MODE, isModeId, type ModeId } from "./modes"
import { qualifyStoredModel, QUALIFIED_MODEL_FORMAT_VERSION, isLegacyModelValue } from "./model-id"

export type { Session }

/**
 * Normalises a stored session to the current format: a canonical model id and
 * the version marker that makes it canonical. Rewritten on every save so the
 * migration is durable rather than re-derived on each load.
 */
function upgradeSession<T extends Session>(session: T): T {
  const legacy = isLegacyModelValue(session)
  return {
    ...session,
    model: qualifyStoredModel(session.model, legacy),
    version: QUALIFIED_MODEL_FORMAT_VERSION,
  }
}

export function getSessionsDir(projectPath: string): string {
  return join(projectPath, ".vicode", "sessions")
}

export function createSession(opts: {
  model: string
  mode?: ModeId
  messages?: Session["messages"]
}): Session {
  const now = new Date().toISOString()
  return {
    id: `sess_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    model: qualifyStoredModel(opts.model, false),
    version: QUALIFIED_MODEL_FORMAT_VERSION,
    messages: opts.messages ?? [],
    createdAt: now,
    updatedAt: now,
    totalTokens: 0,
    totalCost: 0,
    mode: opts.mode ?? DEFAULT_MODE,
  }
}

export function saveSession(session: Session, sessionsDir: string): void {
  mkdirSync(sessionsDir, { recursive: true })
  const filePath = join(sessionsDir, `${session.id}.json`)
  writeFileSync(filePath, JSON.stringify(upgradeSession(session), null, 2), "utf-8")
}

export const MAX_SESSION_NAME_LENGTH = 60

function readName(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined
}

export function loadSession(id: string, sessionsDir: string): Session | null {
  const filePath = join(sessionsDir, `${id}.json`)
  if (!existsSync(filePath)) return null
  try {
    const raw = readFileSync(filePath, "utf-8")
    const parsed = JSON.parse(raw) as Session
    const mode = isModeId(parsed.mode) ? parsed.mode : DEFAULT_MODE
    const name = readName(parsed.name)
    return { ...upgradeSession(parsed), mode, name }
  } catch {
    return null
  }
}

export interface SessionSummary {
  id: string
  name?: string
  model: string
  messageCount: number
  createdAt: string
  updatedAt: string
  totalTokens: number
  totalCost: number
}

export function listSessions(sessionsDir: string): SessionSummary[] {
  if (!existsSync(sessionsDir)) return []

  const files = readdirSync(sessionsDir).filter((f) => f.endsWith(".json"))
  const sessions: SessionSummary[] = []

  for (const file of files) {
    try {
      const raw = readFileSync(join(sessionsDir, file), "utf-8")
      const session = upgradeSession(JSON.parse(raw) as Session)
      sessions.push({
        id: session.id,
        name: readName(session.name),
        model: session.model,
        messageCount: session.messages.length,
        createdAt: session.createdAt,
        updatedAt: session.updatedAt,
        totalTokens: session.totalTokens,
        totalCost: session.totalCost,
      })
    } catch {
      // Skip malformed files
    }
  }

  return sessions.sort(
    (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
  )
}

export function renameSession(session: Session, name: string | null): Session {
  const renamed: Session = { ...session }
  const next = readName(name)
  if (next === undefined) {
    delete renamed.name
  } else {
    renamed.name = next
  }
  return renamed
}

export function deleteSession(id: string, sessionsDir: string): void {
  const filePath = join(sessionsDir, `${id}.json`)
  if (existsSync(filePath)) {
    unlinkSync(filePath)
  }
}

export function loadLatestSession(projectPath: string): Session | null {
  const sessionsDir = getSessionsDir(projectPath)
  const summaries = listSessions(sessionsDir)
  if (summaries.length === 0) return null
  return loadSession(summaries[0]!.id, sessionsDir)
}
