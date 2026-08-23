import { listSessions, loadSession, saveSession, type SessionSummary } from "../core/session"
import type { Command } from "../core/types"

export function formatSessionMeta(summary: SessionSummary): string {
  const timestamp = new Date(summary.updatedAt).toLocaleString()
  return `${timestamp} | ${summary.messageCount} messages | ${summary.model}`
}

export function createSessionCommand(): Command {
  return {
    name: "session",
    description: "Switch to a saved session",
    execute: async (_args, ctx) => {
      if (!ctx.sessions || !ctx.openPicker) {
        throw new Error("/session requires an interactive UI")
      }

      const summaries = listSessions(ctx.sessions.dir)
      if (summaries.length === 0) {
        return "No saved sessions for this project."
      }

      const selectedIndex = await ctx.openPicker({
        title: "Switch to session",
        items: summaries.map((summary) => ({
          label: summary.id,
          metadata: formatSessionMeta(summary),
        })),
      })
      if (selectedIndex === null) return ""

      const summary = summaries[selectedIndex]
      if (!summary) return ""

      const active = ctx.sessions.getActiveSession()
      if (active) {
        saveSession({ ...active, updatedAt: new Date().toISOString() }, ctx.sessions.dir)
      }

      const loaded = loadSession(summary.id, ctx.sessions.dir)
      if (!loaded) {
        return `Could not load session ${summary.id}.`
      }

      ctx.sessions.switchTo(loaded)

      const count = loaded.messages.length
      return `Switched to session ${summary.id} (${count} ${count === 1 ? "message" : "messages"})`
    },
  }
}
