import type { ModelListingPricing } from "../core/provider"
import type { Command } from "../core/types"

export function formatModelPricing(pricing: ModelListingPricing): string {
  if (pricing.kind === "free") return "free"
  const perMillion = (ratePerToken: number) => {
    const dollarsPerMillion = ratePerToken * 1_000_000
    const amount =
      dollarsPerMillion >= 0.01
        ? dollarsPerMillion.toFixed(2)
        : String(parseFloat(dollarsPerMillion.toPrecision(2)))
    return `$${amount}/M`
  }
  return `${perMillion(pricing.inputPricePerToken)} in · ${perMillion(pricing.outputPricePerToken)} out`
}

export function createModelCommand(): Command {
  return {
    name: "model",
    description: "Switch the LLM model mid-session",
    execute: async (_args, ctx) => {
      if (!ctx.models || !ctx.openPicker) {
        throw new Error("/model requires an interactive UI")
      }

      const models = await ctx.models.list()
      if (models.length === 0) {
        return "No models available."
      }

      const currentModelId = ctx.models.getCurrentModelId()
      const selectedIndex = await ctx.openPicker({
        title: "Switch model",
        items: models.map((model) => ({
          label:
            model.id === currentModelId
              ? `${model.name} (current)`
              : model.name,
          metadata: `${model.id} · ${formatModelPricing(model.pricing)}`,
        })),
      })
      if (selectedIndex === null) return ""

      const chosen = models[selectedIndex]
      if (!chosen) return ""

      if (chosen.id === currentModelId) {
        return `Already using ${chosen.name} (${chosen.id})`
      }

      ctx.models.switchTo(chosen.id)

      return `Switched to ${chosen.name} (${chosen.id})`
    },
  }
}
