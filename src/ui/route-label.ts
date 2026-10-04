/**
 * How the live route reads on screen.
 *
 * A Model is reachable through more than one Provider, so a Model name alone
 * never says which credential served the Turn or which bill pays for it. Every
 * surface that names the live Model names the route instead: the canonical
 * `provider/model` id (ADR-0006), verbatim.
 */
import type { ModelInfo } from "../core/provider"
import { formatModelId, parseModelId } from "../core/model-id"

/**
 * The Route Label, as surfaces receive it. A plain string, like the canonical
 * id it is: nothing here reinterprets it.
 */
export type RouteLabel = string

/** What a surface reads when no Provider has been resolved to name one. */
export const UNKNOWN_ROUTE: RouteLabel = "unknown"

/**
 * The Route Label: the canonical id when it names a Provider, that id
 * qualified by the Provider that served it when the id names none, and the
 * Model's own name when there is no id to read at all. An unresolved route
 * reads as itself rather than as a guessed one.
 */
export function routeLabel(model: ModelInfo): RouteLabel {
  const id = model.id.trim()
  if (id === "") return model.name

  const parsed = parseModelId(id)
  if (parsed.provider) return formatModelId(parsed.provider, parsed.model)
  if (model.provider) return formatModelId(model.provider, id)
  return id
}