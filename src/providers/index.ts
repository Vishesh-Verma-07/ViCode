/**
 * Builds a Provider for any id in the registry.
 *
 * OpenRouter has its own module because it needs its own SDK. Everything else
 * is the same `streamText` call against a client that differs only in base URL
 * and which endpoint the model object is taken from, so those clients are built
 * here where the dispatch is visible.
 */
import { createAnthropic } from "@ai-sdk/anthropic"
import { createOpenAI } from "@ai-sdk/openai"
import type { Provider } from "../core/provider"
import {
  PROVIDER_IDS,
  getProvider,
  isProviderId,
  resolveTransport,
  type ProviderId,
} from "../core/providers"
import { resolveModelProtocol } from "../core/catalog"
import { createOpenRouterProvider } from "./openrouter"
import { createSdkProvider, type SdkModel } from "./sdk-provider"

export interface CreateProviderConfig {
  /** The canonical `provider/model` id. */
  model: string
  /** The Provider's API Key. Empty string means unauthenticated. */
  apiKey: string
}

export class UnsupportedModelError extends Error {
  constructor(public readonly provider: ProviderId, public readonly model: string) {
    super(
      `ViCode cannot talk to ${model} on ${provider}: the Model Catalog does not record a wire protocol for it. ` +
        `Load the catalog once with a network connection (/model), or choose another Provider.`,
    )
    this.name = "UnsupportedModelError"
  }
}

export class UnknownProviderError extends Error {
  constructor(public readonly id: string) {
    super(
      `"${id}" is not a known Provider. Expected one of: ${PROVIDER_IDS.join(", ")}.`,
    )
    this.name = "UnknownProviderError"
  }
}

function responsesModel(baseURL?: string): (apiKey: string, model: string) => SdkModel {
  return (apiKey, model) => createOpenAI({ apiKey, baseURL }).responses(model)
}

function messagesModel(baseURL?: string): (apiKey: string, model: string) => SdkModel {
  // `@ai-sdk/anthropic` already authenticates with `x-api-key`, which is the
  // header OpenCode's Anthropic-compatible surface reads. Its base URL is
  // therefore the only thing that differs from the vendor default.
  return (apiKey, model) => createAnthropic({ apiKey, baseURL }).messages(model)
}

/**
 * Resolves a canonical model id to a Provider.
 *
 * Throws `UnsupportedModelError` when the model needs a protocol ViCode has no
 * transport for (ADR-0005). Such models are filtered out of the picker, so
 * reaching here means the model was named directly in config.
 */
export function createProvider(config: CreateProviderConfig): Provider {
  const { model: canonicalId, apiKey } = config
  const sep = canonicalId.indexOf("/")
  if (sep <= 0) {
    throw new Error(
      `Model id "${canonicalId}" is not provider-qualified. Expected "<provider>/<model>".`,
    )
  }
  const providerId = canonicalId.slice(0, sep)
  if (!isProviderId(providerId)) throw new UnknownProviderError(providerId)
  const model = canonicalId.slice(sep + 1)
  const descriptor = getProvider(providerId)

  if (providerId === "openrouter") {
    return createOpenRouterProvider({ apiKey, model })
  }

  const transport = resolveTransport(providerId, resolveModelProtocol(canonicalId))
  if (transport === null) throw new UnsupportedModelError(providerId, model)

  const baseUrl = descriptor.baseUrl
  switch (transport) {
    case "openai-responses":
      return createSdkProvider({ descriptor, apiKey, model, makeModel: responsesModel(baseUrl) })
    case "anthropic-messages":
      return createSdkProvider({ descriptor, apiKey, model, makeModel: messagesModel(baseUrl) })
    default:
      throw new UnsupportedModelError(providerId, model)
  }
}

/** Every Provider is constructible through this one function. */
export { createOpenRouterProvider, createSdkProvider }
export { convertMessages, convertTools } from "./shared"