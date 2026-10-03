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
 *
 * `pricing` is null when the Model has no known price, and so is the result:
 * an unpriced turn must not report a confident number, and `$0.00` is a claim
 * about a Model being free rather than a way of saying nothing is known.
 */
export function calculateCost(tokens: CostableTokens, pricing: ModelPricing | null): number | null {
  if (!pricing) return null

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

/**
 * Sums two running totals.
 *
 * One unknown half makes the total unknown. Adding up the known halves instead
 * would understate the spend by exactly the part nobody could price — which is
 * the number a user reads to decide whether to keep going.
 */
export function addCost(a: number | null, b: number | null): number | null {
  if (a === null || b === null) return null
  return a + b
}

/** How a value ViCode has no figure for is rendered. */
export const UNKNOWN_DISPLAY = "—"

export function formatCost(cost: number | null): string {
  if (cost === null) return UNKNOWN_DISPLAY
  if (cost === 0) return "$0.00"
  if (cost < 1) return `$${cost.toFixed(3)}`
  return `$${cost.toFixed(2)}`
}

export function formatTokens(tokens: number): string {
  if (tokens < 1000) return tokens.toString()
  if (tokens < 1_000_000) return `${(tokens / 1000).toFixed(1)}k`
  return `${(tokens / 1_000_000).toFixed(1)}m`
}