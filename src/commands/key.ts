import type { Command } from "../core/types"

const REMOVE_ALIASES = new Set(["remove", "clear", "delete"])

export function createKeyCommand(): Command {
  return {
    name: "key",
    description: "Set, change or remove your OpenRouter API key",
    execute: async (args, ctx) => {
      if (!ctx.key) {
        throw new Error("/key requires an interactive UI")
      }

      if (REMOVE_ALIASES.has(args[0] ?? "")) {
        const removed = await ctx.key.remove()
        return removed
          ? "API key removed from ~/.vicode/config.json"
          : "No API key to remove."
      }

      const changed = await ctx.key.set()
      return changed
        ? "API key saved to ~/.vicode/config.json"
        : "API key unchanged."
    },
  }
}