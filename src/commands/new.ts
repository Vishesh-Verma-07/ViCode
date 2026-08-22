import { saveSession } from "../core/session"
import type { Command } from "../core/types"

export function createNewCommand(): Command {
  return {
    name: "new",
    description: "Save the current session and start a new one",
    execute: async (_args, ctx) => {
      if (!ctx.sessions) {
        throw new Error("/new requires session storage")
      }

      const active = ctx.sessions.getActiveSession()
      if (active) {
        saveSession({ ...active, updatedAt: new Date().toISOString() }, ctx.sessions.dir)
      }

      ctx.sessions.startFresh()

      const suffix = active ? ` Saved ${active.id}.` : ""
      return `Started a new session.${suffix}`
    },
  }
}
