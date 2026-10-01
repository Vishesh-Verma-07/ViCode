export interface ModelPricing {
  inputPricePerToken: number
  outputPricePerToken: number
  cacheReadPricePerToken?: number
  cacheWritePricePerToken?: number
}

export interface CostableTokens {
  inputTokens: number
  outputTokens: number
  /** Prompt tokens served from the provider's cache. A subset of inputTokens. */
  cacheReadTokens?: number
  /** Prompt tokens written to the provider's cache. A subset of inputTokens. */
  cacheWriteTokens?: number
}

/**
 * Prices a turn from a token breakdown.
 *
 * Cache read and write tokens are priced at their own rates and subtracted from
 * the input bill so they are not charged twice. A rate the catalog does not
 * carry falls back to the full input price, which overestimates rather than
 * underestimates.
 */
export function calculateCost(tokens: CostableTokens, pricing: ModelPricing | null): number {
  if (!pricing) return 0

  const cacheRead = Math.min(tokens.cacheReadTokens ?? 0, tokens.inputTokens)
  const cacheWrite = Math.min(tokens.cacheWriteTokens ?? 0, Math.max(0, tokens.inputTokens - cacheRead))
  const uncachedInput = Math.max(0, tokens.inputTokens - cacheRead - cacheWrite)

  const cacheReadPrice = pricing.cacheReadPricePerToken ?? pricing.inputPricePerToken
  const cacheWritePrice = pricing.cacheWritePricePerToken ?? pricing.inputPricePerToken

  return (
    uncachedInput * pricing.inputPricePerToken +
    cacheRead * cacheReadPrice +
    cacheWrite * cacheWritePrice +
    tokens.outputTokens * pricing.outputPricePerToken
  )
}

export function formatCost(cost: number): string {
  if (cost === 0) return "$0.00"
  if (cost < 1) return `$${cost.toFixed(3)}`
  return `$${cost.toFixed(2)}`
}

export function formatTokens(tokens: number): string {
  if (tokens < 1000) return tokens.toString()
  if (tokens < 1_000_000) return `${(tokens / 1000).toFixed(1)}k`
  return `${(tokens / 1_000_000).toFixed(1)}m`
}