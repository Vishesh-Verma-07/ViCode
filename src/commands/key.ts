import type { Command } from "../core/types"
import {
  PROVIDER_IDS,
  isProviderId,
  providerLabel,
  type ProviderId,
} from "../core/providers"

const REMOVE_ALIASES = new Set(["remove", "clear", "delete"])

/** Resolves a `/key <provider>` argument, defaulting to the active Provider. */
function resolveTarget(
  arg: string | undefined,
  activeProvider: ProviderId,
): ProviderId | null {
  if (arg === undefined) return activeProvider
  return isProviderId(arg) ? arg : null
}

export function createKeyCommand(): Command {
  return {
    name: "key",
    description: `Set, change or remove an API key (/key [${PROVIDER_IDS.join("|")}] ${[...REMOVE_ALIASES].join("|")})`,
    execute: async (args, ctx) => {
      if (!ctx.key) {
        throw new Error("/key requires an interactive UI")
      }

      const activeProvider: ProviderId =
        ctx.providers?.getCurrent() ??
        ctx.models?.getCurrentProvider() ??
        "openrouter"

      // `remove` may lead (`/key remove`) or trail a Provider
      // (`/key anthropic remove`), so the alias decides which slot holds the
      // name. Checking it first also keeps `remove` from being read as one.
      const first = args[0]
      const second = args[1]
      const removing = REMOVE_ALIASES.has(first ?? "") || REMOVE_ALIASES.has(second ?? "")
      const namedProvider = REMOVE_ALIASES.has(first ?? "") ? second : first

      const provider = resolveTarget(namedProvider, activeProvider)

      if (!provider) {
        return `Unknown provider "${namedProvider}". Choose one of: ${PROVIDER_IDS.join(", ")}`
      }
      const label = providerLabel(provider)

      if (removing) {
        const removed = await ctx.key.remove(provider)
        return removed
          ? `Removed the ${label} API key from ~/.vicode/config.json`
          : `No ${label} API key to remove.`
      }

      const changed = await ctx.key.set(provider)
      return changed
        ? `Saved the ${label} API key to ~/.vicode/config.json`
        : `${label} API key unchanged.`
    },
  }
}