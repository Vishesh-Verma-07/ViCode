import { mkdirSync, readFileSync, writeFileSync, existsSync, readdirSync, unlinkSync } from "fs"
import { join } from "path"
import type { Session } from "./types"
import { DEFAULT_MODE, isModeId, type ModeId } from "./modes"
import { qualifyStoredModel, QUALIFIED_MODEL_FORMAT_VERSION, isLegacyModelValue } from "./model-id"

export type { Session }

/**
 * Normalises a stored session to the current format: a canonical model id and
 * the marker that makes it canonical, and a `totalCost` that is a number or
 * explicitly null. A session written under the marker's old field name
 * (`version`) is rewritten here under `modelFormatVersion`, since the record is
 * rebuilt rather than spread.
 *
 * The record is rebuilt field by field rather than spread, so a session written
 * by a version that had a field this one dropped loses it here instead of
 * carrying a dead value forward on every save — `projectPath` went when
 * sessions moved into the project directory (ADR-0002), and a session written
 * before then still carries that machine's absolute path. Rewritten on every
 * save so the migration is durable rather than re-derived on each load.
 */
function upgradeSession(session: Session): Session {
  const legacy = isLegacyModelValue(session)
  const upgraded: Session = {
    id: session.id,
    model: qualifyStoredModel(session.model, legacy),
    modelFormatVersion: QUALIFIED_MODEL_FORMAT_VERSION,
    messages: session.messages,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
    totalTokens: session.totalTokens,
    totalCost: typeof session.totalCost === "number" ? session.totalCost : null,
  }
  if (session.name !== undefined) upgraded.name = session.name
  if (session.mode !== undefined) upgraded.mode = session.mode
  if (session.lastCompaction !== undefined) upgraded.lastCompaction = session.lastCompaction
  return upgraded
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
    modelFormatVersion: QUALIFIED_MODEL_FORMAT_VERSION,
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
  totalCost: number | null
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
