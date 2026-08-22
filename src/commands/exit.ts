import type { Command } from "../core/types"

export function createExitCommand(): Command {
  return {
    name: "exit",
    description: "Stop any response in progress, save the session and quit",
    execute: async (_args, ctx) => {
      if (!ctx.exit) {
        throw new Error("/exit requires an interactive UI")
      }

      await ctx.exit.requestExit()
      return ""
    },
  }
}
