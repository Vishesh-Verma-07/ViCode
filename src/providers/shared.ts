/**
 * Plumbing shared by every Provider implementation.
 *
 * All four transports surface the same AI SDK stream part types and the same
 * normalized usage shape, so message conversion, tool conversion, stream
 * translation, and cost attribution are written once here rather than four
 * times. What genuinely differs per Provider is only the SDK client object and
 * the model id it is asked for.
 */
import type { ModelMessage, ToolSet } from "ai"
import { tool, zodSchema } from "ai"
import type { StreamEvent, TokenUsage } from "../core/provider"
import type { Message, ToolDefinition, ContextSummaryContent } from "../core/types"
import { composeSummaryMessageText } from "../core/compaction"
import { calculateCost } from "../core/cost-calculator"
import { resolvePricing } from "../core/catalog"

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
      const textParts = msg.content
        .filter((c) => c.type === "text" || c.type === "context-summary")
        .map((c) =>
          c.type === "text" ? c.text : composeSummaryMessageText(c as ContextSummaryContent),
        )
      result.push({
        role: "user",
        content: textParts.join("\n"),
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

/**
 * The subset of the AI SDK's normalized usage shape we read. Every transport
 * reports it identically, which is what makes one extractor possible.
 */
export interface NormalizedUsage {
  inputTokens?: number
  inputTokenDetails?: {
    noCacheTokens?: number
    cacheReadTokens?: number
    cacheWriteTokens?: number
  }
  outputTokens?: number
  outputTokenDetails?: {
    textTokens?: number
    reasoningTokens?: number
  }
  totalTokens?: number
}

/**
 * Attributed usage for a canonical `provider/model` id.
 *
 * `inputTokens` is the SDK's total, which is the correct prompt size on every
 * provider even though the providers define it differently underneath: OpenAI
 * counts cached tokens as included, Anthropic adds them on. Pricing is applied
 * to the breakdown, so cached tokens are charged at their own rate rather than
 * at the full input rate.
 */
export function buildUsage(raw: NormalizedUsage | undefined, canonicalModelId: string): TokenUsage {
  const inputTokens = raw?.inputTokens ?? 0
  const outputTokens = raw?.outputTokens ?? 0
  const totalTokens = raw?.totalTokens ?? inputTokens + outputTokens

  const cacheReadTokens = raw?.inputTokenDetails?.cacheReadTokens
  const cacheWriteTokens = raw?.inputTokenDetails?.cacheWriteTokens
  const reasoningTokens = raw?.outputTokenDetails?.reasoningTokens

  const pricing = resolvePricing(canonicalModelId)
  const cost = calculateCost(
    { inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens },
    pricing,
  )

  const usage: TokenUsage = { inputTokens, outputTokens, totalTokens, cost }
  if (cacheReadTokens !== undefined) usage.cacheReadTokens = cacheReadTokens
  if (cacheWriteTokens !== undefined) usage.cacheWriteTokens = cacheWriteTokens
  if (reasoningTokens !== undefined) usage.reasoningTokens = reasoningTokens
  return usage
}

/**
 * Stands in for a completion whose usage never arrived.
 *
 * The token counts are the only honest zero available, but the price of a call
 * nobody reported is unknown rather than free.
 */
export const ZERO_USAGE: TokenUsage = { inputTokens: 0, outputTokens: 0, totalTokens: 0, cost: null }

/**
 * Translates an AI SDK text stream into ViCode's StreamEvents.
 *
 * Reasoning deltas are surfaced separately from answer text so the UI can tell
 * them apart; their tokens are a subset of `outputTokens` and are billed by
 * `buildUsage`, so they are never double-counted here.
 */
export async function* translateStream(
  stream: AsyncIterable<Record<string, unknown>>,
  canonicalModelId: string,
): AsyncIterable<StreamEvent> {
  for await (const raw of stream) {
    switch (raw.type) {
      case "text-delta":
        yield { type: "text-delta", text: typeof raw.text === "string" ? raw.text : "" }
        break
      case "reasoning-delta": {
        const text = typeof raw.delta === "string" ? raw.delta : typeof raw.text === "string" ? raw.text : ""
        if (text !== "") yield { type: "reasoning-delta", text }
        break
      }
      case "tool-input-start":
        yield {
          type: "tool-call-start",
          toolCallId: typeof raw.id === "string" ? raw.id : undefined,
          toolName: typeof raw.toolName === "string" ? raw.toolName : undefined,
        }
        break
      case "tool-input-delta":
        yield {
          type: "tool-call-delta",
          toolCallId: typeof raw.id === "string" ? raw.id : undefined,
          argsDelta: typeof raw.delta === "string" ? raw.delta : "",
        }
        break
      case "tool-call":
        yield {
          type: "tool-call-end",
          toolCallId: typeof raw.toolCallId === "string" ? raw.toolCallId : undefined,
          toolName: typeof raw.toolName === "string" ? raw.toolName : undefined,
          args: (raw.input ?? {}) as Record<string, unknown>,
        }
        break
      case "finish-step":
        yield { type: "finish", usage: buildUsage(raw.usage as NormalizedUsage | undefined, canonicalModelId) }
        break
      case "error":
        yield { type: "error", error: raw.error }
        break
    }
  }
}

/**
 * Runs a single-shot completion, used by Compaction. Reuses the same
 * translation so a summary turn is billed identically to a real one.
 */
export async function runCompletion(
  stream: AsyncIterable<Record<string, unknown>>,
  canonicalModelId: string,
): Promise<{ text: string; usage: TokenUsage }> {
  let text = ""
  let usage: TokenUsage | undefined
  for await (const event of translateStream(stream, canonicalModelId)) {
    if (event.type === "text-delta") text += event.text ?? ""
    if (event.type === "finish") usage = event.usage
  }
  return { text, usage: usage ?? ZERO_USAGE }
}