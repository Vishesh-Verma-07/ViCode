import {
  deleteSession,
  listSessions,
  loadSession,
  MAX_SESSION_NAME_LENGTH,
  renameSession,
  saveSession,
  type SessionSummary,
} from "../core/session"
import type { Command, CommandContext, PickerItem } from "../core/types"

export const SESSION_PICKER_HINT =
  "Ctrl+R renames the highlighted session, Ctrl+D deletes it; /rename names the current session"

export function formatSessionMeta(summary: SessionSummary): string {
  const timestamp = new Date(summary.updatedAt).toLocaleString()
  return `${timestamp} | ${summary.messageCount} messages | ${summary.model}`
}

export function formatSessionName(summary: SessionSummary): string {
  return summary.name ? `${summary.name} (${summary.id})` : summary.id
}

/**
 * Writes a new name onto a stored Session and returns the summary as it now
 * stands. The active Session is renamed through the app, so the in-memory
 * record and the file move together — otherwise the next Turn would save the
 * old name back over it. Any other Session is rewritten on disk directly.
 * Renaming never touches `updatedAt`, so the most-recent-first order holds.
 */
function renameStoredSession(
  sessions: NonNullable<CommandContext["sessions"]>,
  summary: SessionSummary,
  rawName: string,
): SessionSummary {
  const trimmed = rawName.trim()
  const name = trimmed.length === 0 ? null : trimmed.slice(0, MAX_SESSION_NAME_LENGTH)

  if (sessions.getActiveSession()?.id === summary.id) {
    sessions.rename(name)
  } else {
    const stored = loadSession(summary.id, sessions.dir)
    if (stored) saveSession(renameSession(stored, name), sessions.dir)
  }

  return { ...summary, name: name ?? undefined }
}

export function createSessionCommand(): Command {
  return {
    name: "session",
    description: "Switch to, rename, or delete a saved session",
    usage: "Pick a session; Enter switches, Ctrl+R renames it, Ctrl+D deletes it.",
    execute: async (_args, ctx) => {
      const sessions = ctx.sessions
      const openPicker = ctx.openPicker
      if (!sessions || !openPicker) {
        throw new Error("/session requires an interactive UI")
      }

      // Kept in step with the Picker's own copy of the rows: each delete or
      // rename here answers one the Picker just applied, so a later Enter's
      // index still names the same Session.
      let summaries = listSessions(sessions.dir)
      if (summaries.length === 0) {
        return "No saved sessions for this project."
      }

      const summaryForItem = new Map<PickerItem, SessionSummary>()
      const items = summaries.map((summary) => {
        const item: PickerItem = {
          label: formatSessionName(summary),
          metadata: formatSessionMeta(summary),
        }
        summaryForItem.set(item, summary)
        return item
      })

      const selectedIndex = await openPicker({
        title: "Switch to session",
        hint: SESSION_PICKER_HINT,
        items,
        onDelete: (item) => {
          const summary = summaryForItem.get(item)
          if (!summary) return
          const wasActive = sessions.getActiveSession()?.id === summary.id
          deleteSession(summary.id, sessions.dir)
          summaryForItem.delete(item)
          summaries = summaries.filter((s) => s.id !== summary.id)
          // The deleted file is gone, so the live Session must not be rebuilt
          // from it on the next Turn.
          if (wasActive) sessions.startFresh()
        },
        onRename: (item, name) => {
          const summary = summaryForItem.get(item)
          if (!summary) return undefined
          const updated = renameStoredSession(sessions, summary, name)
          summaryForItem.set(item, updated)
          summaries = summaries.map((s) => (s.id === updated.id ? updated : s))
          return formatSessionName(updated)
        },
      })
      if (selectedIndex === null) return ""

      const summary = summaries[selectedIndex]
      if (!summary) return ""

      const active = sessions.getActiveSession()
      if (active) {
        saveSession({ ...active, updatedAt: new Date().toISOString() }, sessions.dir)
      }

      const loaded = loadSession(summary.id, sessions.dir)
      if (!loaded) {
        return `Could not load session ${summary.id}.`
      }

      sessions.switchTo(loaded)

      const count = loaded.messages.length
      return `Switched to ${formatSessionName(summary)} — ${count} ${count === 1 ? "message" : "messages"}`
    },
  }
}
