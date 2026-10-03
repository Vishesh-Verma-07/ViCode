import type { Message, ToolDefinition } from "./types"
import type { ProviderId } from "./providers"

export interface StreamEvent {
  type: "text-delta" | "reasoning-delta" | "tool-call-start" | "tool-call-delta" | "tool-call-end" | "finish" | "error"
  text?: string
  toolCallId?: string
  toolName?: string
  args?: Record<string, unknown>
  argsDelta?: string
  usage?: TokenUsage
  error?: unknown
}

export interface TokenUsage {
  inputTokens: number
  outputTokens: number
  totalTokens: number
  /**
   * Dollars spent, or null when the Model has no known price. Never 0 as a
   * stand-in for unknown: that reads as a free turn.
   */
  cost: number | null
  /** Prompt tokens served from the Provider's cache. A subset of inputTokens. */
  cacheReadTokens?: number
  /** Prompt tokens written to the Provider's cache. A subset of inputTokens. */
  cacheWriteTokens?: number
  /**
   * Output tokens spent reasoning. A subset of outputTokens — already billed
   * as output, so this is a breakdown, not an extra charge.
   */
  reasoningTokens?: number
}

export interface ModelInfo {
  id: string
  name: string
  /** The window in tokens, or null when the Model Catalog publishes none. */
  contextLength: number | null
  /** The Provider serving this Model, as a canonical `provider/model` prefix. */
  provider?: ProviderId
}

/**
 * What the Model Catalog knows about a Model's price.
 *
 * `unknown` is not `free`: a Model the catalog never priced must not be shown
 * or totalled as though it cost nothing.
 */
export type ModelListingPricing =
  | { kind: "unknown" }
  | { kind: "free" }
  | { kind: "paid"; inputPricePerToken: number; outputPricePerToken: number }

export interface ModelListing {
  id: string
  name: string
  pricing: ModelListingPricing
  contextLength: number | null
}

export interface Provider {
  streamChat(
    messages: Message[],
    tools: ToolDefinition[],
    systemPrompt: string,
    abortSignal?: AbortSignal,
  ): AsyncIterable<StreamEvent>
  /**
   * Produce a plain-text completion over `transcript` guided by `summaryPrompt`.
   * Used by Compaction to condense folded history into the Running Summary.
   * Optional: a Provider without it is treated as compaction-incapable.
   */
  summarize?(
    transcript: string,
    summaryPrompt: string,
    abortSignal?: AbortSignal,
  ): Promise<{ text: string; usage: TokenUsage }>
  getModelInfo(): ModelInfo
  listModels(): Promise<ModelListing[]>
}
