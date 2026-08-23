import type { Provider, StreamEvent, TokenUsage, ModelInfo, ModelListing, ModelListingPricing } from "../core/provider"
import type { Message, ToolDefinition } from "../core/types"
import type { ModelMessage, ToolSet } from "ai"
import { streamText, tool, zodSchema } from "ai"
import { createOpenRouter } from "@openrouter/ai-sdk-provider"
import { getModelPricing, calculateCost } from "../core/cost-calculator"
import { join, dirname } from "path"
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "fs"

export interface OpenRouterProviderConfig {
  apiKey: string
  model: string
}

export interface ListModelsOptions {
  /** Where the model-list cache lives. Defaults to ~/.vicode/models-cache.json */
  cachePath?: string
  /** HTTP boundary override for tests. */
  fetchImpl?: typeof fetch
}

const OPENROUTER_MODELS_URL = "https://openrouter.ai/api/v1/models"

function defaultModelsCachePath(): string {
  const home = process.env.HOME || process.env.USERPROFILE || ""
  return join(home, ".vicode", "models-cache.json")
}

export function createOpenRouterProvider(config: OpenRouterProviderConfig, options?: ListModelsOptions): Provider {
  const openrouter = createOpenRouter({ apiKey: config.apiKey })
  const modelId = config.model

  return {
    async *streamChat(
      messages: Message[],
      tools: ToolDefinition[],
      systemPrompt: string,
      abortSignal?: AbortSignal,
    ): AsyncIterable<StreamEvent> {
      const sdkMessages = convertMessages(messages)
      const sdkTools = convertTools(tools)

      const result = streamText({
        model: openrouter.chat(modelId),
        messages: sdkMessages,
        system: systemPrompt,
        tools: sdkTools,
        abortSignal,
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
          case "tool-input-start":
            yield {
              type: "tool-call-start",
              toolCallId: event.id,
              toolName: event.toolName,
            }
            break
          case "tool-input-delta":
            yield {
              type: "tool-call-delta",
              toolCallId: event.id,
              argsDelta: event.delta,
            }
            break
          case "tool-call":
            yield {
              type: "tool-call-end",
              toolCallId: event.toolCallId,
              toolName: event.toolName,
              args: event.input as Record<string, unknown>,
            }
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

    listModels(): Promise<ModelListing[]> {
      return listOpenRouterModels(options)
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

interface ModelsCacheFile {
  fetchedAt: string
  models: ModelListing[]
}

function parseOpenRouterModels(payload: unknown): ModelListing[] {
  const data = (payload as { data?: unknown } | null)?.data
  if (!Array.isArray(data)) return []

  const listings: ModelListing[] = []
  for (const entry of data) {
    const model = entry as {
      id?: unknown
      name?: unknown
      pricing?: { prompt?: unknown; completion?: unknown }
    }
    if (typeof model.id !== "string" || model.id === "") continue

    const inputPricePerToken = toPricePerToken(model.pricing?.prompt)
    const outputPricePerToken = toPricePerToken(model.pricing?.completion)
    let pricing: ModelListingPricing
    if (inputPricePerToken <= 0 && outputPricePerToken <= 0) {
      pricing = { kind: "free" }
    } else {
      pricing = { kind: "paid", inputPricePerToken, outputPricePerToken }
    }

    listings.push({
      id: model.id,
      name: typeof model.name === "string" && model.name !== "" ? model.name : model.id,
      pricing,
    })
  }

  return listings
}

function toPricePerToken(value: unknown): number {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0
  if (typeof value === "string") {
    const parsed = Number.parseFloat(value)
    return Number.isFinite(parsed) ? parsed : 0
  }
  return 0
}

function isValidModelListing(value: unknown): value is ModelListing {
  if (typeof value !== "object" || value === null) return false
  const listing = value as { id?: unknown; name?: unknown; pricing?: unknown }
  if (typeof listing.id !== "string" || typeof listing.name !== "string") return false
  if (typeof listing.pricing !== "object" || listing.pricing === null) return false
  const pricing = listing.pricing as { kind?: unknown }
  if (pricing.kind === "free") return true
  if (pricing.kind === "paid") {
    const rates = listing.pricing as { inputPricePerToken?: unknown; outputPricePerToken?: unknown }
    return typeof rates.inputPricePerToken === "number" && typeof rates.outputPricePerToken === "number"
  }
  return false
}

function readModelsCache(cachePath: string): ModelListing[] | null {
  if (!existsSync(cachePath)) return null
  try {
    const raw = JSON.parse(readFileSync(cachePath, "utf-8")) as { models?: unknown }
    if (!Array.isArray(raw.models)) return null
    const models = raw.models.filter(isValidModelListing)
    return models.length > 0 ? models : null
  } catch {
    return null
  }
}

function writeModelsCache(cachePath: string, models: ModelListing[]): void {
  try {
    mkdirSync(dirname(cachePath), { recursive: true })
    const payload: ModelsCacheFile = { fetchedAt: new Date().toISOString(), models }
    writeFileSync(cachePath, JSON.stringify(payload, null, 2), "utf-8")
  } catch {
    // Cache writing is best-effort; never fail the listing itself.
  }
}

export async function listOpenRouterModels(options?: ListModelsOptions): Promise<ModelListing[]> {
  const fetchImpl = options?.fetchImpl ?? fetch
  const cachePath = options?.cachePath ?? defaultModelsCachePath()

  let fetched: ModelListing[] | null = null
  try {
    const response = await fetchImpl(OPENROUTER_MODELS_URL)
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    fetched = parseOpenRouterModels(await response.json())
    if (fetched.length === 0) throw new Error("empty model list")
  } catch {
    fetched = null
  }

  if (fetched) {
    writeModelsCache(cachePath, fetched)
    return fetched
  }

  const cached = readModelsCache(cachePath)
  if (cached) return cached

  throw new Error(
    "Failed to fetch OpenRouter models and no cached model list is available. Connect to the internet once to populate the cache.",
  )
}
