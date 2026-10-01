import { MAX_SESSION_NAME_LENGTH } from "../core/session"
import type { Command } from "../core/types"

const CLEAR_ALIASES = new Set(["clear", "remove", "delete"])

export const RENAME_USAGE =
  "Give it a name: /rename <name>, or /rename clear to drop the current one."

function isClearRequest(args: string[]): boolean {
  return args.length === 1 && CLEAR_ALIASES.has(args[0]!)
}

export function createRenameCommand(): Command {
  return {
    name: "rename",
    description: "Name the current session, or clear its name",
    usage: RENAME_USAGE,
    execute: async (args, ctx) => {
      if (!ctx.sessions) {
        throw new Error("/rename requires an interactive UI")
      }

      const active = ctx.sessions.getActiveSession()
      if (!active) {
        return "No session to rename yet — send a message first."
      }

      if (isClearRequest(args)) {
        if (!active.name) {
          return `This session has no name. ${RENAME_USAGE}`
        }
        ctx.sessions.rename(null)
        return "Session name cleared."
      }

      const name = args.join(" ").trim()
      if (!name) return RENAME_USAGE

      if (name.length > MAX_SESSION_NAME_LENGTH) {
        return `That name is ${name.length} characters — session names are limited to ${MAX_SESSION_NAME_LENGTH}.`
      }

      ctx.sessions.rename(name)
      return `Renamed this session to "${name}".`
    },
  }
}
