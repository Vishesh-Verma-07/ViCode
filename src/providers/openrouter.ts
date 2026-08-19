import type { Provider, StreamEvent, TokenUsage, ModelInfo } from "../core/provider"
import type { Message, ToolDefinition } from "../core/types"
import type { ModelMessage, ToolSet } from "ai"
import { streamText, tool, zodSchema } from "ai"
import { createOpenRouter } from "@openrouter/ai-sdk-provider"
import { getModelPricing, calculateCost } from "../core/cost-calculator"

export interface OpenRouterProviderConfig {
  apiKey: string
  model: string
}

export function createOpenRouterProvider(config: OpenRouterProviderConfig): Provider {
  const openrouter = createOpenRouter({ apiKey: config.apiKey })
  const modelId = config.model

  return {
    async *streamChat(
      messages: Message[],
      tools: ToolDefinition[],
      systemPrompt: string,
    ): AsyncIterable<StreamEvent> {
      const sdkMessages = convertMessages(messages)
      const sdkTools = convertTools(tools)

      const result = streamText({
        model: openrouter.chat(modelId),
        messages: sdkMessages,
        system: systemPrompt,
        tools: sdkTools,
        providerOptions: {
          openrouter: {
            usage: { include: true },
          },
        },
      })

      for await (const event of result.stream) {
        switch (event.type) {
          case "text-delta":
            yield { type: "text-delta", text: event.text }
            break
          case "tool-call":
            yield {
              type: "tool-call-end",
              toolCallId: event.toolCallId,
              toolName: event.toolName,
              args: event.input as Record<string, unknown>,
            }
            break
          case "tool-result":
            break
          case "finish-step": {
            const usage = extractUsage(event.usage, modelId)
            yield { type: "finish", usage }
            break
          }
          case "error":
            yield { type: "error", error: event.error }
            break
        }
      }
    },

    getModelInfo(): ModelInfo {
      return { id: modelId, name: modelId }
    },
  }
}

export function convertMessages(messages: Message[]): ModelMessage[] {
  const result: ModelMessage[] = []

  for (const msg of messages) {
    if (msg.role === "system") {
      const textParts = msg.content.filter((c) => c.type === "text")
      result.push({
        role: "system",
        content: textParts.map((c) => c.text).join("\n"),
      })
    } else if (msg.role === "user") {
      const textParts = msg.content.filter((c) => c.type === "text")
      result.push({
        role: "user",
        content: textParts.map((c) => c.text).join("\n"),
      })
    } else if (msg.role === "assistant") {
      const parts: ModelMessage[] = []
      const textParts = msg.content.filter((c) => c.type === "text")
      const toolCallParts = msg.content.filter((c) => c.type === "tool-call")

      if (textParts.length > 0 || toolCallParts.length > 0) {
        const content: Array<{ type: "text"; text: string } | { type: "tool-call"; toolCallId: string; toolName: string; input: unknown }> = []

        for (const t of textParts) {
          content.push({ type: "text", text: t.text })
        }
        for (const tc of toolCallParts) {
          content.push({
            type: "tool-call",
            toolCallId: tc.toolCallId,
            toolName: tc.toolName,
            input: tc.args,
          })
        }

        result.push({ role: "assistant", content })
      }
    } else if (msg.role === "tool") {
      const toolResultParts = msg.content.filter((c) => c.type === "tool-result")
      result.push({
        role: "tool",
        content: toolResultParts.map((c) => ({
          type: "tool-result" as const,
          toolCallId: c.toolCallId,
          toolName: c.toolName,
          output: { type: "text" as const, value: c.result },
        })),
      })
    }
  }

  return result
}

export function convertTools(tools: ToolDefinition[]): ToolSet {
  const result: ToolSet = {}

  for (const t of tools) {
    result[t.name] = tool({
      description: t.description,
      inputSchema: zodSchema(t.parameters),
    })
  }

  return result
}

function extractUsage(raw: { inputTokens?: number; outputTokens?: number; totalTokens?: number }, modelId: string): TokenUsage {
  const inputTokens = raw.inputTokens ?? 0
  const outputTokens = raw.outputTokens ?? 0
  const totalTokens = raw.totalTokens ?? 0
  const pricing = getModelPricing(modelId)
  const cost = calculateCost(inputTokens, outputTokens, pricing)
  return { inputTokens, outputTokens, totalTokens, cost }
}
