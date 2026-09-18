import type { Command } from "../core/types"

export function createKeyCommand(): Command {
  return {
    name: "key",
    description: "Set or change your OpenRouter API key",
    execute: async (_args, ctx) => {
      if (!ctx.key) {
        throw new Error("/key requires an interactive UI")
      }

      const changed = await ctx.key.set()

      return changed
        ? "API key saved to ~/.vicode/config.json"
        : "API key unchanged."
    },
  }
}