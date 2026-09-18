import type { Command } from "../core/types"

export function createHomeCommand(): Command {
  return {
    name: "home",
    description: "Return to the welcome screen",
    execute: async (_args, ctx) => {
      if (!ctx.navigation) {
        throw new Error("/home requires an interactive UI")
      }

      ctx.navigation.home()
      return ""
    },
  }
}