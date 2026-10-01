import type { ModelListingPricing } from "../core/provider"
import type { Command, PickerItem, ProviderOffering } from "../core/types"
import { formatModelId } from "../core/model-id"

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

/** How this Provider bills, which is what distinguishes one route from another. */
function kindLabel(offering: ProviderOffering): string {
  return offering.kind === "vendor" ? "first-party" : offering.billingNote ?? "gateway"
}

/**
 * One flat row per Model, preceded by a Provider heading, because ~150 models
 * need grouping to be navigable while a single list still keeps one cursor.
 */
function buildModelRows(
  offerings: ProviderOffering[],
  currentModelId: string,
): { rows: PickerItem[]; canonicalIds: (string | null)[] } {
  const rows: PickerItem[] = []
  const canonicalIds: (string | null)[] = []

  for (const offering of offerings) {
    if (offering.models.length === 0) continue

    rows.push({ label: offering.label, metadata: kindLabel(offering) })
    canonicalIds.push(null)

    for (const model of offering.models) {
      const canonicalId = formatModelId(offering.provider, model.id)
      rows.push({
        label: canonicalId === currentModelId ? `${model.name} (current)` : model.name,
        metadata: `${canonicalId} · ${formatModelPricing(model.pricing)}${
          offering.hasKey ? "" : " · no key"
        }`,
      })
      canonicalIds.push(canonicalId)
    }
  }

  return { rows, canonicalIds }
}

export function createModelCommand(): Command {
  return {
    name: "model",
    description: "Switch the model, and with it the provider",
    execute: async (_args, ctx) => {
      if (!ctx.models || !ctx.openPicker) {
        throw new Error("/model requires an interactive UI")
      }

      const offerings = await ctx.models.listProviders()
      const currentModelId = ctx.models.getCurrentModelId()

      if (offerings.every((o) => o.models.length === 0)) {
        return "No models available. The model catalog could not be loaded."
      }

      const { rows, canonicalIds } = buildModelRows(offerings, currentModelId)
      const selectedIndex = await ctx.openPicker({
        title: "Switch model",
        items: rows,
        defaultIndex: Math.max(
          0,
          canonicalIds.indexOf(currentModelId) - 1,
        ),
      })
      if (selectedIndex === null) return ""

      const chosen = canonicalIds[selectedIndex]
      // A heading row: treat choosing it as a no-op rather than an error.
      if (!chosen) return ""
      if (chosen === currentModelId) return `Already using ${chosen}`

      ctx.models.switchTo(chosen)
      return `Switched to ${chosen}`
    },
  }
}

export function createProviderCommand(): Command {
  return {
    name: "provider",
    description: "Switch provider, keeping the model when that provider offers it",
    execute: async (_args, ctx) => {
      if (!ctx.providers || !ctx.openPicker) {
        throw new Error("/provider requires an interactive UI")
      }

      const offerings = await ctx.providers.list()
      const current = ctx.providers.getCurrent()

      const selectedIndex = await ctx.openPicker({
        title: "Switch provider",
        items: offerings.map((o) => ({
          label: o.provider === current ? `${o.label} (current)` : o.label,
          metadata: `${o.models.length} models · ${kindLabel(o)}${o.hasKey ? "" : " · no key"}`,
        })),
        defaultIndex: Math.max(
          0,
          offerings.findIndex((o) => o.provider === current),
        ),
      })
      if (selectedIndex === null) return ""
      if (selectedIndex < 0 || selectedIndex >= offerings.length) return ""

      const chosen = offerings[selectedIndex]!
      if (chosen.provider === current) {
        return `Already using ${chosen.label}`
      }

      const result = await ctx.providers.switchTo(chosen.provider)
      if (result === null) return `Cannot switch to ${chosen.label}.`
      return `Switched to ${chosen.label} (${result})`
    },
  }
}