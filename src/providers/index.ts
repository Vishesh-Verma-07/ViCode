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
import { parseModelId, type UnknownModelRef } from "../core/model-id"
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
  const ref = parseModelId(canonicalId)
  if (!ref.provider) throw unqualifiedModelIdError(canonicalId, ref)
  const { provider: providerId, model } = ref
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

/**
 * Says why an id names no Provider. Which of the three it is changes what the
 * user does about it: an id with no prefix was never qualified, a prefix
 * outside the registry is a Provider ViCode does not serve, and a prefix with
 * nothing after it names no Model at all.
 *
 * The split itself is already settled — `parseModelId` refused the id above — so
 * this only reads the prefix back out to name it in the message.
 */
function unqualifiedModelIdError(canonicalId: string, ref: UnknownModelRef): Error {
  const sep = ref.model.indexOf("/")
  const prefix = sep > 0 ? ref.model.slice(0, sep) : ""
  if (prefix === "") {
    return new Error(
      `Model id "${canonicalId}" is not provider-qualified. Expected "<provider>/<model>".`,
    )
  }
  if (!isProviderId(prefix)) return new UnknownProviderError(prefix)
  return new Error(
    `Model id "${canonicalId}" names no Model. Expected "<provider>/<model>".`,
  )
}

/** Every Provider is constructible through this one function. */
export { createOpenRouterProvider, createSdkProvider }
export { convertMessages, convertTools } from "./shared"