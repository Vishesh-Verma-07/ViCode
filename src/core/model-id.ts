/**
 * Provider-qualified model ids. See ADR-0006.
 *
 * A model is named `<providerId>/<modelId>`, split on the FIRST separator only.
 * OpenRouter model ids contain slashes of their own, so a last-separator split
 * would read `nvidia` as the provider in
 * `openrouter/nvidia/nemotron-3-ultra-550b-a55b:free`.
 */
import { isProviderId, type ProviderId } from "./providers"

export interface ModelRef {
  provider: ProviderId
  model: string
}

export interface UnknownModelRef {
  provider: null
  model: string
}

/** The provider id that owns every model id written before multi-provider support. */
export const LEGACY_PROVIDER: ProviderId = "openrouter"

/**
 * Splits a canonical id. Returns `provider: null` when the id carries no known
 * provider prefix, leaving the caller to decide how to treat it.
 */
export function parseModelId(id: string): ModelRef | UnknownModelRef {
  const trimmed = id.trim()
  const sep = trimmed.indexOf("/")
  if (sep <= 0) return { provider: null, model: trimmed }

  const prefix = trimmed.slice(0, sep)
  const rest = trimmed.slice(sep + 1)
  if (rest === "") return { provider: null, model: trimmed }
  if (!isProviderId(prefix)) return { provider: null, model: trimmed }

  return { provider: prefix, model: rest }
}

/** Builds a canonical id from its parts. */
export function formatModelId(provider: ProviderId, model: string): string {
  return `${provider}/${model}`
}

/**
 * Resolves a model id to a ref, falling back to OpenRouter when the id carries
 * no usable provider prefix.
 *
 * Prefer `qualifyStoredModel` for anything read from disk: it knows whether the
 * value predates qualification, which this cannot. This is the best-effort
 * fallback for a hand-edited value.
 */
export function resolveModelId(id: string): ModelRef {
  const parsed = parseModelId(id)
  if (parsed.provider) return parsed
  return { provider: LEGACY_PROVIDER, model: parsed.model }
}

/**
 * On-disk format version at which model ids became provider-qualified. Shared
 * by sessions and config, which is why the marker is one number for both.
 *
 * This marker exists because the two id shapes collide: `openai/gpt-4o` is both
 * an OpenRouter model id (prefix = maker) and a canonical id (prefix =
 * Provider). Reading it as the Provider would silently re-route every existing
 * session to a vendor the user never chose. Anything stored before this version
 * predates multi-provider support, so its model id can only have meant
 * OpenRouter and is rewritten unconditionally.
 */
export const QUALIFIED_MODEL_FORMAT_VERSION = 2

/** True when a stored value was written before provider qualification. */
export function isLegacyModelValue(value: unknown): boolean {
  if (typeof value !== "object" || value === null) return true
  return (value as { version?: unknown }).version !== QUALIFIED_MODEL_FORMAT_VERSION
}

/**
 * Rewrites a stored model id to its canonical form.
 *
 * `legacy` must be true only for values written before provider qualification,
 * where the id is known to be an OpenRouter one. Unqualified legacy input is
 * left alone otherwise: a hand-edited value that cannot be resolved is not
 * something to guess at.
 */
export function qualifyStoredModel(value: unknown, legacy: boolean): string {
  if (typeof value !== "string" || value.trim() === "") return ""
  const trimmed = value.trim()

  // Pre-qualification data is OpenRouter by definition, so prefix it without
  // consulting the prefix, which may collide with a vendor name.
  if (legacy) return formatModelId(LEGACY_PROVIDER, trimmed)

  const parsed = parseModelId(trimmed)
  if (parsed.provider) return formatModelId(parsed.provider, parsed.model)
  return trimmed
}