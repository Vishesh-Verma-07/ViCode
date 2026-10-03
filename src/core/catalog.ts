/**
 * The Model Catalog: models, prices, and context windows for every Provider.
 *
 * Source is models.dev's public api.json, filtered to the five Providers in
 * the registry and trimmed to the fields ViCode reads, so the on-disk cache is
 * orders of magnitude smaller than the 5.26 MB payload. See ADR-0005.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs"
import { dirname, join } from "path"
import type { ModelPricing } from "./cost-calculator"
import type { ModelListing, ModelListingPricing } from "./provider"
import { getProvider, isProviderId, listProviders, type ProviderId } from "./providers"

export const MODELS_DEV_URL = "https://models.dev/api.json"

/** How long a cached catalog is considered fresh. */
export const CATALOG_TTL_MS = 24 * 60 * 60 * 1000

/**
 * The wire protocol a model speaks, as named by the catalog's `provider.npm`.
 * Only `openai` and `anthropic` have transports (ADR-0005).
 */
export type WireProtocol = "openai" | "anthropic" | "google" | "openai-compatible" | "unknown"

export interface CatalogModel {
  id: string
  name: string
  protocol: WireProtocol
  /** The window in tokens, or null when the catalog publishes none. */
  contextLength: number | null
  /** Billed rates, or null when the catalog publishes no usable price. */
  pricing: ModelPricing | null
  /** The model's maker, independent of the Provider serving it. */
  vendorId?: string
}

export interface Catalog {
  providers: Record<ProviderId, Record<string, CatalogModel>>
}

export interface CatalogOptions {
  cachePath?: string
  fetchImpl?: typeof fetch
  /** Override the freshness window. Tests pass 0 to force a refetch. */
  ttlMs?: number
}

/** Protocols we have a transport for. Anything else is not listed. */
const SUPPORTED_PROTOCOLS: ReadonlySet<WireProtocol> = new Set<WireProtocol>(["openai", "anthropic"])

export function defaultCatalogCachePath(): string {
  const home = process.env.HOME || process.env.USERPROFILE || ""
  return join(home, ".vicode", "models-dev-cache.json")
}

/* -------------------------------------------------------------------------- */
/* Parsing models.dev                                                          */
/* -------------------------------------------------------------------------- */

function protocolFromNpm(npm: unknown): WireProtocol {
  if (typeof npm !== "string") return "unknown"
  if (npm.includes("anthropic")) return "anthropic"
  if (npm.includes("google")) return "google"
  if (npm.includes("openai-compatible")) return "openai-compatible"
  if (npm.includes("openai")) return "openai"
  return "unknown"
}

function perMillion(value: unknown): number | undefined {
  const num = typeof value === "string" ? Number.parseFloat(value) : value
  if (typeof num !== "number" || !Number.isFinite(num) || num < 0) return undefined
  return num / 1_000_000
}

/**
 * Billed rates for one model, or null when the catalog does not publish a
 * usable price.
 *
 * Both directions must parse. Guessing a missing rate as zero is how an
 * unpriced model ends up looking free, which is the one thing the picker and
 * the cost meter must never claim.
 */
function parsePricing(cost: unknown): ModelPricing | null {
  if (typeof cost !== "object" || cost === null) return null
  const c = cost as Record<string, unknown>
  const input = perMillion(c.input)
  const output = perMillion(c.output)
  if (input === undefined || output === undefined) return null

  const pricing: ModelPricing = { inputPricePerToken: input, outputPricePerToken: output }
  const cacheRead = perMillion(c.cache_read)
  const cacheWrite = perMillion(c.cache_write)
  if (cacheRead !== undefined) pricing.cacheReadPricePerToken = cacheRead
  if (cacheWrite !== undefined) pricing.cacheWritePricePerToken = cacheWrite
  return pricing
}

function parseContextLength(limit: unknown): number | null {
  if (typeof limit !== "object" || limit === null) return null
  const context = (limit as { context?: unknown }).context
  if (typeof context !== "number" || !Number.isFinite(context) || context <= 0) return null
  return context
}

function parseProviderEntry(payload: unknown): Record<string, CatalogModel> | null {
  if (typeof payload !== "object" || payload === null) return null
  const models = (payload as { models?: unknown }).models
  if (typeof models !== "object" || models === null) return null

  const out: Record<string, CatalogModel> = {}
  for (const [id, raw] of Object.entries(models as Record<string, unknown>)) {
    if (typeof raw !== "object" || raw === null) continue
    const model = raw as Record<string, unknown>

    // Deprecated entries are still served by these providers; listing them
    // invites a call that is billed at someone else's rate card.
    if (model.status === "deprecated") continue

    // Prefer the per-model protocol override, then the provider-level default.
    const perModel = model.provider as { npm?: unknown } | undefined
    const providerNpm =
      perModel?.npm ??
      ((payload as { npm?: unknown }).npm as unknown)

    const catalogModel: CatalogModel = {
      id,
      name: typeof model.name === "string" && model.name !== "" ? model.name : id,
      protocol: protocolFromNpm(perModel?.npm ?? providerNpm),
      contextLength: parseContextLength(model.limit),
      pricing: parsePricing(model.cost),
    }
    if (typeof model.canonical_model_id === "string") catalogModel.vendorId = model.canonical_model_id

    out[id] = catalogModel
  }
  return out
}

/** Filters a full models.dev payload down to the registered Providers. */
export function parseCatalog(payload: unknown): Catalog | null {
  if (typeof payload !== "object" || payload === null) return null
  const providers = payload as Record<string, unknown>
  const out = {} as Record<ProviderId, Record<string, CatalogModel>>
  let found = 0
  for (const descriptor of listProviders()) {
    const parsed = parseProviderEntry(providers[descriptor.catalogId])
    out[descriptor.id] = parsed ?? {}
    if (parsed && Object.keys(parsed).length > 0) found++
  }
  return found > 0 ? { providers: out } : null
}

/* -------------------------------------------------------------------------- */
/* Cache                                                                       */
/* -------------------------------------------------------------------------- */

interface CatalogCacheFile {
  fetchedAt: string
  providers: Catalog["providers"]
}

function cachePath(options?: CatalogOptions): string {
  return options?.cachePath ?? defaultCatalogCachePath()
}

function readCacheFile(options?: CatalogOptions): CatalogCacheFile | null {
  const path = cachePath(options)
  if (!existsSync(path)) return null
  try {
    const raw = JSON.parse(readFileSync(path, "utf-8")) as CatalogCacheFile
    if (typeof raw?.fetchedAt !== "string" || typeof raw.providers !== "object" || raw.providers === null) {
      return null
    }
    return raw
  } catch {
    return null
  }
}

export function readCatalog(options?: CatalogOptions): Catalog | null {
  const raw = readCacheFile(options)
  return raw ? { providers: raw.providers } : null
}

/** True when `fetchedAt` is inside the freshness window. */
function withinTtl(fetchedAt: string, options?: CatalogOptions): boolean {
  const ttl = options?.ttlMs ?? CATALOG_TTL_MS
  if (ttl <= 0) return false
  const at = Date.parse(fetchedAt)
  if (Number.isNaN(at)) return false
  return Date.now() - at < ttl
}

export function isCatalogFresh(catalog: Catalog | null, options?: CatalogOptions): boolean {
  if (!catalog) return false
  const raw = readCacheFile(options)
  return raw !== null && withinTtl(raw.fetchedAt, options)
}

/** The cached catalog, but only while it is still inside the TTL. */
export function readFreshCatalog(options?: CatalogOptions): Catalog | null {
  const raw = readCacheFile(options)
  if (!raw || !withinTtl(raw.fetchedAt, options)) return null
  return { providers: raw.providers }
}

function writeCatalog(catalog: Catalog, options?: CatalogOptions): void {
  const path = cachePath(options)
  try {
    mkdirSync(dirname(path), { recursive: true })
    const payload: CatalogCacheFile = { fetchedAt: new Date().toISOString(), providers: catalog.providers }
    writeFileSync(path, JSON.stringify(payload), "utf-8")
  } catch {
    // Cache writing is best-effort; a read-only home directory must not break
    // model listing.
  }
}

/** Fetches from models.dev, writing the cache on success. */
export async function fetchCatalog(options?: CatalogOptions): Promise<Catalog> {
  const fetchImpl = options?.fetchImpl ?? fetch
  const response = await fetchImpl(MODELS_DEV_URL)
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  const catalog = parseCatalog(await response.json())
  if (!catalog) throw new Error("Model catalog contained no known providers")
  writeCatalog(catalog, options)
  return catalog
}

/**
 * Catalog for the process, resolved once. `null` until the first successful
 * load; every lookup degrades to "unknown" rather than failing.
 */
let active: Catalog | null = null

export function getActiveCatalog(): Catalog | null {
  return active
}

export function setActiveCatalog(catalog: Catalog | null): void {
  active = catalog
}

/**
 * Returns a catalog, preferring a fresh cache and falling back to the network.
 *
 * A cache inside the TTL is returned without touching the network, so a normal
 * launch costs no bandwidth. Only a missing or stale cache pays for a fetch, and
 * when that fetch fails the stale copy still beats nothing. Throws only when
 * neither a cache nor a network is available.
 */
export async function ensureCatalog(options?: CatalogOptions): Promise<Catalog> {
  if (isCatalogFresh(active, options)) return active as Catalog

  const fresh = readFreshCatalog(options)
  if (fresh) {
    active = fresh
    return fresh
  }

  try {
    active = await fetchCatalog(options)
    return active
  } catch {
    const cached = readCatalog(options)
    if (cached) {
      active = cached
      return cached
    }
    throw new Error(
      "Failed to load the model catalog and no cached copy is available. Connect to the internet once to populate it.",
    )
  }
}

/**
 * Loads whatever is available without waiting on the network: the active
 * catalog if already resolved, else the cache. Used at startup so a slow or
 * absent network never blocks the TUI rendering.
 */
export function loadCatalogOffline(options?: CatalogOptions): Catalog | null {
  if (active) return active
  const cached = readCatalog(options)
  if (cached) active = cached
  return active
}

/* -------------------------------------------------------------------------- */
/* Lookups                                                                     */
/* -------------------------------------------------------------------------- */

/** Catalog entry for one model on one Provider, or null when unknown. */
export function lookupModel(provider: ProviderId, model: string, catalog = active): CatalogModel | null {
  return catalog?.providers[provider]?.[model] ?? null
}

/** True when ViCode has a transport for the model's protocol (ADR-0005). */
export function isModelReachable(provider: ProviderId, entry: CatalogModel): boolean {
  const descriptor = getProvider(provider)
  // A Provider with a fixed transport speaks it for every model it offers.
  if (descriptor.transport) return true
  return SUPPORTED_PROTOCOLS.has(entry.protocol)
}

/**
 * Every model a Provider offers that ViCode can actually call, shaped for the
 * picker. Sorted cheapest-first so free and low-cost models surface at the top.
 */
export function listCatalogModels(provider: ProviderId, catalog = active): ModelListing[] {
  const entries = catalog?.providers[provider]
  if (!entries) return []

  const listings: ModelListing[] = []
  for (const entry of Object.values(entries)) {
    if (!isModelReachable(provider, entry)) continue

    const rates = entry.pricing
    const pricing: ModelListingPricing =
      !rates
        ? { kind: "unknown" }
        : rates.inputPricePerToken <= 0 && rates.outputPricePerToken <= 0
          ? { kind: "free" }
          : {
              kind: "paid",
              inputPricePerToken: rates.inputPricePerToken,
              outputPricePerToken: rates.outputPricePerToken,
            }

    listings.push({ id: entry.id, name: entry.name, pricing, contextLength: entry.contextLength ?? null })
  }

  listings.sort((a, b) => {
    const delta = priceRank(a.pricing) - priceRank(b.pricing)
    // Infinity minus Infinity is NaN, which no sort can read as an ordering.
    if (Number.isNaN(delta)) return a.name.localeCompare(b.name)
    return delta
  })
  return listings
}

/** Free first, then paid by combined rate, then unknown — where "we have no idea" cannot outrank a price. */
function priceRank(pricing: ModelListingPricing): number {
  if (pricing.kind === "free") return -1
  if (pricing.kind === "unknown") return Number.POSITIVE_INFINITY
  return pricing.inputPricePerToken + pricing.outputPricePerToken
}

/**
 * Pricing for a canonical `provider/model` id. Falls back to the active
 * Provider's entry for a bare (pre-qualification) model id.
 */
export function resolvePricing(
  canonicalId: string,
  catalog = active,
): ModelPricing | null {
  const resolved = resolveProviderAndModel(canonicalId)
  if (!resolved) return null
  return lookupModel(resolved.provider, resolved.model, catalog)?.pricing ?? null
}

/** Context window for a canonical id, or null when the catalog is silent. */
export function resolveContextLength(
  canonicalId: string,
  catalog = active,
): number | null {
  const resolved = resolveProviderAndModel(canonicalId)
  if (!resolved) return null
  return lookupModel(resolved.provider, resolved.model, catalog)?.contextLength ?? null
}

/** The wire protocol a model speaks, per the catalog. */
export function resolveModelProtocol(
  canonicalId: string,
  catalog = active,
): WireProtocol | undefined {
  const resolved = resolveProviderAndModel(canonicalId)
  if (!resolved) return undefined
  return lookupModel(resolved.provider, resolved.model, catalog)?.protocol
}

function resolveProviderAndModel(canonicalId: string): { provider: ProviderId; model: string } | null {
  const sep = canonicalId.indexOf("/")
  if (sep <= 0) return null
  const provider = canonicalId.slice(0, sep)
  const model = canonicalId.slice(sep + 1)
  if (model === "") return null
  if (!isProviderId(provider)) return null
  return { provider, model }
}