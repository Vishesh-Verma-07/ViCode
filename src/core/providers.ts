/**
 * The Provider registry: the five credentialed routes ViCode can chat through.
 *
 * A Provider is a route, not a company — see CONTEXT.md. Every Provider here
 * resolves to a base URL, an API Key, a wire transport, and a set of Models
 * described by the Model Catalog (ADR-0005).
 */
import type { WireProtocol } from "./catalog"

export const PROVIDER_IDS = [
  "openrouter",
  "openai",
  "anthropic",
  "opencode",
  "opencode-go",
] as const

export type ProviderId = (typeof PROVIDER_IDS)[number]

export type ProviderKind = "vendor" | "gateway"

/**
 * How a Provider carries a request. Only two are implemented (ADR-0005): the
 * gateways we support additionally choose per Model, because OpenCode routes
 * different models over different protocols on the same credential.
 */
export type ProviderTransport = "openai-chat" | "openai-responses" | "anthropic-messages"

export interface ProviderDescriptor {
  id: ProviderId
  /** Human-facing name. Shown wherever the active route is named. */
  label: string
  kind: ProviderKind
  /**
   * The provider id this Provider is known by in the Model Catalog. Differs
   * from `id` nowhere today, but the two are independent concepts and the
   * catalog is a third party's namespace.
   */
  catalogId: string
  /** Environment variables consulted, in order, when no key is configured. */
  env: string[]
  /** Where a user obtains a key. Shown by the API Key Entry Screen. */
  keyUrl: string
  /**
   * Transport used when the Model does not itself dictate one. Gateways leave
   * this null and resolve per Model from the catalog instead.
   */
  transport: ProviderTransport | null
  /** Base URL for providers served by a first-party SDK or an override. */
  baseUrl?: string
  /** Human-readable note about how this Provider bills. Shown in the picker. */
  billingNote?: string
}

const DESCRIPTORS: Record<ProviderId, ProviderDescriptor> = {
  openrouter: {
    id: "openrouter",
    label: "OpenRouter",
    kind: "gateway",
    catalogId: "openrouter",
    env: ["OPENROUTER_API_KEY"],
    keyUrl: "https://openrouter.ai/keys",
    transport: "openai-chat",
    billingNote: "pay per token",
  },
  openai: {
    id: "openai",
    label: "OpenAI",
    kind: "vendor",
    catalogId: "openai",
    env: ["OPENAI_API_KEY"],
    keyUrl: "https://platform.openai.com/api-keys",
    transport: "openai-responses",
    billingNote: "pay per token",
  },
  anthropic: {
    id: "anthropic",
    label: "Anthropic",
    kind: "vendor",
    catalogId: "anthropic",
    env: ["ANTHROPIC_API_KEY"],
    keyUrl: "https://console.anthropic.com/settings/keys",
    transport: "anthropic-messages",
    billingNote: "pay per token",
  },
  opencode: {
    id: "opencode",
    label: "OpenCode Zen",
    kind: "gateway",
    catalogId: "opencode",
    // Zen and Go are one console with one key; both accept OPENCODE_API_KEY.
    env: ["OPENCODE_API_KEY"],
    keyUrl: "https://opencode.ai/console",
    // Per-model: Claude goes over Anthropic Messages, GPT over Responses.
    transport: null,
    baseUrl: "https://opencode.ai/zen/v1",
    billingNote: "pay per token, prepaid balance",
  },
  "opencode-go": {
    id: "opencode-go",
    label: "OpenCode Go",
    kind: "gateway",
    catalogId: "opencode-go",
    env: ["OPENCODE_API_KEY"],
    keyUrl: "https://opencode.ai/console",
    transport: null,
    baseUrl: "https://opencode.ai/zen/go/v1",
    billingNote: "subscription plan, not per token",
  },
}

export function isProviderId(value: string): value is ProviderId {
  return (PROVIDER_IDS as readonly string[]).includes(value)
}

export function getProvider(id: ProviderId): ProviderDescriptor {
  return DESCRIPTORS[id]
}

/** All Providers in registry order, which is the order pickers render them. */
export function listProviders(): ProviderDescriptor[] {
  return PROVIDER_IDS.map((id) => DESCRIPTORS[id])
}

export function providerLabel(id: ProviderId): string {
  return DESCRIPTORS[id].label
}

/**
 * The wire protocol a request to `provider` for `model` should use.
 *
 * Gateways resolve per Model from the catalog because a single credential
 * reaches several protocols. Vendors have one transport for every model.
 */
export function resolveTransport(
  provider: ProviderId,
  modelProtocol: WireProtocol | undefined,
): ProviderTransport | null {
  const descriptor = DESCRIPTORS[provider]
  if (descriptor.transport) return descriptor.transport
  switch (modelProtocol) {
    case "anthropic":
      return "anthropic-messages"
    case "openai":
      return "openai-responses"
    default:
      // An unknown protocol is not silently coerced to a wrong wire format.
      return null
  }
}