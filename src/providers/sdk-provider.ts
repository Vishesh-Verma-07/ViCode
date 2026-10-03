/**
 * The generic Provider factory for transports backed by an AI SDK client.
 *
 * Everything an SDK-backed Provider does is identical once a model object
 * exists, so the only thing a concrete Provider contributes is the client: how
 * to turn an API Key and a Model into something `streamText` accepts. That
 * decision lives with the client, not here.
 */
import { streamText } from "ai"
import type { ModelListing, Provider, StreamEvent, TokenUsage } from "../core/provider"
import type { Message, ToolDefinition } from "../core/types"
import type { ProviderDescriptor } from "../core/providers"
import { convertMessages, convertTools, runCompletion, translateStream } from "./shared"
import { ensureCatalog, listCatalogModels, resolveContextLength } from "../core/catalog"
import { formatModelId } from "../core/model-id"

/** Whatever `streamText` accepts as its model, without naming the SDK type. */
export type SdkModel = Parameters<typeof streamText>[0]["model"]

/**
 * Builds the client for one request. Called per stream so a rotated key or a
 * switched model needs nothing more than a new closure.
 */
export type SdkModelFactory = (apiKey: string, model: string) => SdkModel

/**
 * Per-request provider options. Some gateways need these to return usage at
 * all, so they are part of the Provider's identity rather than a setting.
 * Typed by derivation so it always matches the SDK version in use.
 */
export type ProviderOptions = NonNullable<Parameters<typeof streamText>[0]["providerOptions"]>

export interface SdkProviderConfig {
  descriptor: ProviderDescriptor
  apiKey: string
  /** The model id as this Provider's own API spells it, without the prefix. */
  model: string
  makeModel: SdkModelFactory
  providerOptions?: ProviderOptions
}

export function createSdkProvider(config: SdkProviderConfig): Provider {
  const { descriptor, apiKey, model, makeModel, providerOptions } = config
  const canonicalId = formatModelId(descriptor.id, model)

  return {
    async *streamChat(
      messages: Message[],
      tools: ToolDefinition[],
      systemPrompt: string,
      abortSignal?: AbortSignal,
    ): AsyncIterable<StreamEvent> {
      const result = streamText({
        model: makeModel(apiKey, model),
        messages: convertMessages(messages),
        system: systemPrompt,
        tools: convertTools(tools),
        providerOptions,
        abortSignal,
      })
      yield* translateStream(result.stream as AsyncIterable<Record<string, unknown>>, canonicalId)
    },

    async summarize(
      transcript: string,
      summaryPrompt: string,
      abortSignal?: AbortSignal,
    ): Promise<{ text: string; usage: TokenUsage }> {
      const result = streamText({
        model: makeModel(apiKey, model),
        messages: [{ role: "user", content: transcript }],
        system: summaryPrompt,
        providerOptions,
        abortSignal,
      })
      return runCompletion(result.stream as AsyncIterable<Record<string, unknown>>, canonicalId)
    },

    getModelInfo() {
      // contextLength is always present, null included: an unmeasured window is
      // a fact about the Model, not a missing field.
      return {
        id: canonicalId,
        name: model,
        provider: descriptor.id,
        contextLength: resolveContextLength(canonicalId),
      }
    },

    async listModels(): Promise<ModelListing[]> {
      return listCatalogModels(descriptor.id, await ensureCatalog())
    },
  }
}