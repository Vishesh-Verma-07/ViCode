import { createOpenRouter } from "@openrouter/ai-sdk-provider"
import type { Provider } from "../core/provider"
import { getProvider } from "../core/providers"
import { createSdkProvider } from "./sdk-provider"

export interface OpenRouterProviderConfig {
  apiKey: string
  model: string
}

/**
 * OpenRouter talks the Chat Completions dialect through its own SDK, which is
 * not interchangeable with the plain OpenAI one: its usage figures only arrive
 * when explicitly requested, so the flag is part of what this Provider *is* and
 * not a configurable option.
 */
export function createOpenRouterProvider(config: OpenRouterProviderConfig): Provider {
  return createSdkProvider({
    descriptor: getProvider("openrouter"),
    apiKey: config.apiKey,
    model: config.model,
    makeModel: (apiKey, model) => createOpenRouter({ apiKey }).chat(model),
    providerOptions: {
      openrouter: { usage: { include: true } },
    },
  })
}

/** Re-exported so callers keep one import site for Provider plumbing. */
export { convertMessages, convertTools } from "./shared"