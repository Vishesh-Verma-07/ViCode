export interface ModelPricing {
  inputPricePerToken: number
  outputPricePerToken: number
}

const MODEL_PRICING: Record<string, ModelPricing> = {
  "anthropic/claude-sonnet-4": {
    inputPricePerToken: 3 / 1_000_000,
    outputPricePerToken: 15 / 1_000_000,
  },
  "anthropic/claude-3.5-sonnet": {
    inputPricePerToken: 3 / 1_000_000,
    outputPricePerToken: 15 / 1_000_000,
  },
  "anthropic/claude-3.5-haiku": {
    inputPricePerToken: 0.8 / 1_000_000,
    outputPricePerToken: 4 / 1_000_000,
  },
  "openai/gpt-4o": {
    inputPricePerToken: 2.5 / 1_000_000,
    outputPricePerToken: 10 / 1_000_000,
  },
  "openai/gpt-4o-mini": {
    inputPricePerToken: 0.15 / 1_000_000,
    outputPricePerToken: 0.6 / 1_000_000,
  },
  "google/gemini-2.0-flash-001": {
    inputPricePerToken: 0.1 / 1_000_000,
    outputPricePerToken: 0.4 / 1_000_000,
  },
  "google/gemini-2.5-pro": {
    inputPricePerToken: 1.25 / 1_000_000,
    outputPricePerToken: 10 / 1_000_000,
  },
  "deepseek/deepseek-chat": {
    inputPricePerToken: 0.14 / 1_000_000,
    outputPricePerToken: 0.28 / 1_000_000,
  },
}

export function getModelPricing(modelId: string): ModelPricing | null {
  return MODEL_PRICING[modelId] ?? null
}

export function calculateCost(
  inputTokens: number,
  outputTokens: number,
  pricing: ModelPricing | null,
): number {
  if (!pricing) return 0
  return inputTokens * pricing.inputPricePerToken + outputTokens * pricing.outputPricePerToken
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
