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

export interface Provider {
  streamChat(
    messages: Message[],
    tools: ToolDefinition[],
    systemPrompt: string,
  ): AsyncIterable<StreamEvent>
  getModelInfo(): ModelInfo
}
