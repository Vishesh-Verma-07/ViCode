import type { Command } from "../core/types"

export function createCompactCommand(): Command {
  return {
    name: "compact",
    description: "Fold older messages into a summary and keep the context window lean",
    execute: async (_args, ctx) => {
      if (!ctx.compaction) {
        throw new Error("/compact requires compaction capability")
      }
      const report = await ctx.compaction.compact()
      if (report.foldedMessages === 0) {
        return "Nothing to compact — the current turn is already the whole context."
      }
      return `Context compacted — ${report.foldedMessages} messages folded into the running summary.`
    },
  }
}