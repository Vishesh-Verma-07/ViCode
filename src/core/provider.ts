import type { Message, ToolDefinition } from "./types"

export interface StreamEvent {
  type: "text-delta" | "tool-call-start" | "tool-call-delta" | "tool-call-end" | "finish" | "error"
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
}

export interface ModelInfo {
  id: string
  name: string
}

export type ModelListingPricing =
  | { kind: "free" }
  | { kind: "paid"; inputPricePerToken: number; outputPricePerToken: number }

export interface ModelListing {
  id: string
  name: string
  pricing: ModelListingPricing
}

export interface Provider {
  streamChat(
    messages: Message[],
    tools: ToolDefinition[],
    systemPrompt: string,
    abortSignal?: AbortSignal,
  ): AsyncIterable<StreamEvent>
  getModelInfo(): ModelInfo
  listModels(): Promise<ModelListing[]>
}
