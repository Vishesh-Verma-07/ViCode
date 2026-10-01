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
  cost: number
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
  contextLength?: number
  /** The Provider serving this Model, as a canonical `provider/model` prefix. */
  provider?: ProviderId
}

export type ModelListingPricing =
  | { kind: "free" }
  | { kind: "paid"; inputPricePerToken: number; outputPricePerToken: number }

export interface ModelListing {
  id: string
  name: string
  pricing: ModelListingPricing
  contextLength?: number
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
