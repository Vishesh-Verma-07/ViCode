import { mkdirSync, readFileSync, writeFileSync, existsSync, readdirSync, unlinkSync } from "fs"
import { join } from "path"
import type { Session } from "./types"
import { DEFAULT_MODE, isModeId, type ModeId } from "./modes"

export type { Session }

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
    model: opts.model,
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
  writeFileSync(filePath, JSON.stringify(session, null, 2), "utf-8")
}

export function loadSession(id: string, sessionsDir: string): Session | null {
  const filePath = join(sessionsDir, `${id}.json`)
  if (!existsSync(filePath)) return null
  try {
    const raw = readFileSync(filePath, "utf-8")
    const parsed = JSON.parse(raw) as Session
    const mode = isModeId(parsed.mode) ? parsed.mode : DEFAULT_MODE
    return { ...parsed, mode }
  } catch {
    return null
  }
}

export interface SessionSummary {
  id: string
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
      const session = JSON.parse(raw) as Session
      sessions.push({
        id: session.id,
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
