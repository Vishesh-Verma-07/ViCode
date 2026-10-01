import { describe, it, expect, beforeEach, afterEach } from "bun:test"
import {
  MODELS_DEV_URL,
  CATALOG_TTL_MS,
  parseCatalog,
  ensureCatalog,
  loadCatalogOffline,
  readCatalog,
  isCatalogFresh,
  readFreshCatalog,
  listCatalogModels,
  lookupModel,
  resolvePricing,
  resolveContextLength,
  resolveModelProtocol,
  isModelReachable,
  fetchCatalog,
  setActiveCatalog,
  getActiveCatalog,
  type Catalog,
} from "@/core/catalog"
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from "fs"
import { join } from "path"
import { tmpdir } from "os"

/**
 * A cut-down models.dev payload: one Provider per transport decision that
 * matters, plus the fields ViCode actually reads.
 */
const MODELS_DEV_PAYLOAD = {
  openrouter: {
    npm: "@ai-sdk/openai-compatible",
    models: {
      "nvidia/nemotron-3-ultra-550b-a55b:free": {
        name: "Nemotron 3 Ultra (free)",
        cost: { input: "0", output: "0" },
        limit: { context: 128000 },
      },
      "anthropic/claude-sonnet-4": {
        name: "Claude Sonnet 4",
        cost: { input: "3", output: "15", cache_read: "0.3", cache_write: "3.75" },
        limit: { context: 200000 },
      },
      "google/gemini-3-pro": {
        name: "Gemini 3 Pro",
        cost: { input: "2", output: "12" },
        limit: { context: 1000000 },
      },
      "stale/model": { name: "Old", cost: { input: "1", output: "1" }, status: "deprecated" },
    },
  },
  openai: {
    npm: "@ai-sdk/openai",
    models: {
      "gpt-6.1-sol": {
        name: "GPT-6.1 Sol",
        cost: { input: "5", output: "25", cache_read: "0.5" },
        limit: { context: 400000 },
      },
    },
  },
  anthropic: {
    npm: "@ai-sdk/anthropic",
    models: {
      "claude-opus-5-5": {
        name: "Claude Opus 5.5",
        cost: { input: "15", output: "75" },
        limit: { context: 500000 },
      },
    },
  },
  opencode: {
    npm: "@ai-sdk/openai-compatible",
    models: {
      // A gateway can serve two protocols over one credential.
      "claude-sonnet-4": { provider: { npm: "@ai-sdk/anthropic" }, cost: { input: "3", output: "15" } },
      "gpt-5.3-codex": { provider: { npm: "@ai-sdk/openai" }, cost: { input: "5", output: "25" } },
    },
  },
  opencode_go: { models: {} },
}

describe("parseCatalog", () => {
  it("keeps only the registered Providers", () => {
    const catalog = parseCatalog({ ...MODELS_DEV_PAYLOAD, some_other_provider: { models: { x: {} } } })
    expect(Object.keys(catalog!.providers).sort()).toEqual([
      "anthropic",
      "openai",
      "opencode",
      "opencode-go",
      "openrouter",
    ])
  })

  it("converts per-million prices to per-token", () => {
    const entry = parseCatalog(MODELS_DEV_PAYLOAD)!.providers.openrouter!["anthropic/claude-sonnet-4"]!
    expect(entry.pricing).toEqual({
      inputPricePerToken: 3 / 1_000_000,
      outputPricePerToken: 15 / 1_000_000,
      cacheReadPricePerToken: 0.3 / 1_000_000,
      cacheWritePricePerToken: 3.75 / 1_000_000,
    })
  })

  it("omits cache rates the catalog does not publish", () => {
    const entry = parseCatalog(MODELS_DEV_PAYLOAD)!.providers.openai!["gpt-6.1-sol"]!
    expect(entry.pricing.cacheWritePricePerToken).toBeUndefined()
    expect(entry.pricing.cacheReadPricePerToken).toBe(0.5 / 1_000_000)
  })

  it("reads the context limit", () => {
    const entry = parseCatalog(MODELS_DEV_PAYLOAD)!.providers.openai!["gpt-6.1-sol"]!
    expect(entry.contextLength).toBe(400000)
  })

  it("infers the protocol from the Provider's npm package", () => {
    const catalog = parseCatalog(MODELS_DEV_PAYLOAD)!
    expect(catalog.providers.openai!["gpt-6.1-sol"]!.protocol).toBe("openai")
    expect(catalog.providers.anthropic!["claude-opus-5-5"]!.protocol).toBe("anthropic")
    expect(catalog.providers.openrouter!["anthropic/claude-sonnet-4"]!.protocol).toBe(
      "openai-compatible",
    )
  })

  it("lets a per-model npm override the Provider default", () => {
    const catalog = parseCatalog(MODELS_DEV_PAYLOAD)!
    expect(catalog.providers.opencode!["claude-sonnet-4"]!.protocol).toBe("anthropic")
    expect(catalog.providers.opencode!["gpt-5.3-codex"]!.protocol).toBe("openai")
  })

  it("drops deprecated models", () => {
    const catalog = parseCatalog(MODELS_DEV_PAYLOAD)!
    expect(catalog.providers.openrouter!["stale/model"]).toBeUndefined()
  })

  it("returns null when nothing known is present", () => {
    expect(parseCatalog({ some_other_provider: { models: { x: {} } } })).toBeNull()
  })

  it("returns null for a non-object payload", () => {
    expect(parseCatalog(null)).toBeNull()
    expect(parseCatalog("nope")).toBeNull()
  })

  it("tolerates a Provider with no models", () => {
    expect(parseCatalog(MODELS_DEV_PAYLOAD)!.providers["opencode-go"]).toEqual({})
  })

  it("falls back to the model id when the catalog has no name", () => {
    const catalog = parseCatalog({
      openai: { npm: "@ai-sdk/openai", models: { nameless: { cost: { input: "1", output: "1" } } } },
    })!
    expect(catalog.providers.openai!.nameless!.name).toBe("nameless")
  })

  it("treats unparseable prices as zero rather than NaN", () => {
    const catalog = parseCatalog({
      openai: { npm: "@ai-sdk/openai", models: { m: { cost: { input: "abc", output: null } } } },
    })!
    expect(catalog.providers.openai!.m!.pricing).toEqual({
      inputPricePerToken: 0,
      outputPricePerToken: 0,
    })
  })
})

describe("isModelReachable", () => {
  const catalog = parseCatalog(MODELS_DEV_PAYLOAD)!

  it("accepts a model ViCode has a transport for", () => {
    const entry = catalog.providers.anthropic!["claude-opus-5-5"]!
    expect(isModelReachable("anthropic", entry)).toBe(true)
  })

  it("accepts every OpenRouter model, since it proxies all of them", () => {
    // OpenRouter has a fixed Chat Completions transport, so its protocol field
    // is informational and must not hide a model ViCode can actually call.
    const entry = catalog.providers.openrouter!["google/gemini-3-pro"]!
    expect(isModelReachable("openrouter", entry)).toBe(true)
  })

  it("accepts a gateway model ViCode does have a protocol for", () => {
    const entry = catalog.providers.openrouter!["anthropic/claude-sonnet-4"]!
    expect(isModelReachable("openrouter", entry)).toBe(true)
  })

  it("rejects a gateway model we have no protocol for", () => {
    expect(isModelReachable("opencode", { id: "m", name: "m", protocol: "google", pricing: { inputPricePerToken: 0, outputPricePerToken: 0 } })).toBe(false)
  })

  it("rejects a gateway model with an unknown protocol", () => {
    expect(isModelReachable("opencode-go", { id: "m", name: "m", protocol: "unknown", pricing: { inputPricePerToken: 0, outputPricePerToken: 0 } })).toBe(false)
  })
})

describe("listCatalogModels", () => {
  const catalog = parseCatalog(MODELS_DEV_PAYLOAD)!

  it("returns nothing for an unknown Provider", () => {
    expect(listCatalogModels("opencode-go", catalog)).toEqual([])
  })

  it("marks a zero-priced model free", () => {
    const models = listCatalogModels("openrouter", catalog)
    const free = models.find((m) => m.id === "nvidia/nemotron-3-ultra-550b-a55b:free")
    expect(free?.pricing).toEqual({ kind: "free" })
  })

  it("sorts free models ahead of paid ones", () => {
    const models = listCatalogModels("openrouter", catalog)
    expect(models[0]?.id).toBe("nvidia/nemotron-3-ultra-550b-a55b:free")
  })

  it("excludes models ViCode cannot call", () => {
    const ids = listCatalogModels("opencode", catalog).map((m) => m.id)
    expect(ids.sort()).toEqual(["claude-sonnet-4", "gpt-5.3-codex"])
  })

  it("carries the context length through to the listing", () => {
    const sol = listCatalogModels("openai", catalog)[0]!
    expect(sol.contextLength).toBe(400000)
  })
})

describe("lookups", () => {
  const catalog = parseCatalog(MODELS_DEV_PAYLOAD)!

  it("finds pricing by canonical id", () => {
    expect(resolvePricing("openai/gpt-6.1-sol", catalog)?.inputPricePerToken).toBe(5 / 1_000_000)
  })

  it("keeps a slash inside the model id", () => {
    expect(resolveContextLength("openrouter/anthropic/claude-sonnet-4", catalog)).toBe(200000)
  })

  it("returns null for an unknown model", () => {
    expect(resolvePricing("openai/nope", catalog)).toBeNull()
  })

  it("returns undefined for an unqualified id", () => {
    expect(resolvePricing("gpt-4o", catalog)).toBeNull()
  })

  it("returns undefined for an unknown provider prefix", () => {
    expect(resolvePricing("google/gemini-3-pro", catalog)).toBeNull()
  })

  it("reports the wire protocol", () => {
    expect(resolveModelProtocol("opencode/claude-sonnet-4", catalog)).toBe("anthropic")
    expect(resolveModelProtocol("opencode/gpt-5.3-codex", catalog)).toBe("openai")
  })

  it("looks a model up by provider and model directly", () => {
    expect(lookupModel("anthropic", "claude-opus-5-5", catalog)?.name).toBe("Claude Opus 5.5")
  })
})

describe("catalog cache", () => {
  let tempDir: string
  let cachePath: string

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "vicode-catalog-test-"))
    cachePath = join(tempDir, "cache.json")
    setActiveCatalog(null)
  })

  afterEach(() => {
    setActiveCatalog(null)
    rmSync(tempDir, { recursive: true, force: true })
  })

  function makeFetchOk(payload: unknown = MODELS_DEV_PAYLOAD): typeof fetch {
    return (async () =>
      new Response(JSON.stringify(payload), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })) as unknown as typeof fetch
  }

  function makeFetchFailing(): typeof fetch {
    return (async () => {
      throw new Error("network unreachable")
    }) as unknown as typeof fetch
  }

  it("fetches models.dev and trims the cache to the registered Providers", async () => {
    let url: string | undefined
    const fetchImpl = (async (input: Parameters<typeof fetch>[0]) => {
      url = String(input)
      return new Response(JSON.stringify(MODELS_DEV_PAYLOAD), { status: 200 })
    }) as unknown as typeof fetch

    const catalog = await fetchCatalog({ cachePath, fetchImpl })

    expect(url).toBe(MODELS_DEV_URL)
    expect(Object.keys(catalog.providers).sort()).toEqual([
      "anthropic",
      "openai",
      "opencode",
      "opencode-go",
      "openrouter",
    ])
    const onDisk = JSON.parse(readFileSync(cachePath, "utf-8")) as { providers: unknown }
    expect(Object.keys(onDisk.providers as object).sort()).toEqual([
      "anthropic",
      "openai",
      "opencode",
      "opencode-go",
      "openrouter",
    ])
  })

  it("does not refetch while the cache is fresh", async () => {
    writeFileSync(
      cachePath,
      JSON.stringify({
        fetchedAt: new Date().toISOString(),
        providers: parseCatalog(MODELS_DEV_PAYLOAD)!.providers,
      }),
    )

    let calls = 0
    const fetchImpl = (async () => {
      calls++
      return new Response(JSON.stringify(MODELS_DEV_PAYLOAD), { status: 200 })
    }) as unknown as typeof fetch

    await ensureCatalog({ cachePath, fetchImpl })
    expect(calls).toBe(0)
  })

  it("honours the TTL across process restarts, not just within one", async () => {
    // The whole point of the cache: a relaunch inside 24h costs no bandwidth.
    writeFileSync(
      cachePath,
      JSON.stringify({
        fetchedAt: new Date().toISOString(),
        providers: parseCatalog(MODELS_DEV_PAYLOAD)!.providers,
      }),
    )

    let calls = 0
    const fetchImpl = (async () => {
      calls++
      return new Response(JSON.stringify(MODELS_DEV_PAYLOAD), { status: 200 })
    }) as unknown as typeof fetch

    setActiveCatalog(null) // simulate a fresh process
    await ensureCatalog({ cachePath, fetchImpl })
    expect(calls).toBe(0)
  })

  it("reports a cache inside the TTL as fresh and one outside it as stale", () => {
    const providers = parseCatalog(MODELS_DEV_PAYLOAD)!.providers
    writeFileSync(
      cachePath,
      JSON.stringify({ fetchedAt: new Date().toISOString(), providers }),
    )
    expect(isCatalogFresh({ providers }, { cachePath })).toBe(true)

    writeFileSync(
      cachePath,
      JSON.stringify({
        fetchedAt: new Date(Date.now() - CATALOG_TTL_MS - 1000).toISOString(),
        providers,
      }),
    )
    expect(isCatalogFresh({ providers }, { cachePath })).toBe(false)
    expect(readFreshCatalog({ cachePath })).toBeNull()
    expect(readCatalog({ cachePath })).not.toBeNull()
  })

  it("refetches every time when ttlMs is 0", async () => {
    writeFileSync(
      cachePath,
      JSON.stringify({
        fetchedAt: new Date().toISOString(),
        providers: parseCatalog(MODELS_DEV_PAYLOAD)!.providers,
      }),
    )

    let calls = 0
    const fetchImpl = (async () => {
      calls++
      return new Response(JSON.stringify(MODELS_DEV_PAYLOAD), { status: 200 })
    }) as unknown as typeof fetch

    await ensureCatalog({ cachePath, fetchImpl, ttlMs: 0 })
    expect(calls).toBe(1)
  })

  it("refetches once the cache is stale", async () => {
    writeFileSync(
      cachePath,
      JSON.stringify({
        fetchedAt: new Date(Date.now() - CATALOG_TTL_MS - 1000).toISOString(),
        providers: parseCatalog(MODELS_DEV_PAYLOAD)!.providers,
      }),
    )

    let calls = 0
    const fetchImpl = (async () => {
      calls++
      return new Response(JSON.stringify(MODELS_DEV_PAYLOAD), { status: 200 })
    }) as unknown as typeof fetch

    await ensureCatalog({ cachePath, fetchImpl })
    expect(calls).toBe(1)
  })

  it("serves the stale cache when the network fails", async () => {
    writeFileSync(
      cachePath,
      JSON.stringify({
        fetchedAt: new Date(Date.now() - CATALOG_TTL_MS - 1000).toISOString(),
        providers: parseCatalog(MODELS_DEV_PAYLOAD)!.providers,
      }),
    )

    const catalog = await ensureCatalog({ cachePath, fetchImpl: makeFetchFailing() })
    expect(catalog.providers.openai!["gpt-6.1-sol"]!.name).toBe("GPT-6.1 Sol")
  })

  it("treats a non-200 response as a failure and serves the cache", async () => {
    writeFileSync(
      cachePath,
      JSON.stringify({
        fetchedAt: new Date(Date.now() - CATALOG_TTL_MS - 1000).toISOString(),
        providers: parseCatalog(MODELS_DEV_PAYLOAD)!.providers,
      }),
    )

    const fetchImpl = (async () => new Response("rate limited", { status: 429 })) as unknown as typeof fetch
    const catalog = await ensureCatalog({ cachePath, fetchImpl })
    expect(catalog.providers.openai!["gpt-6.1-sol"]).toBeDefined()
  })

  it("throws a clear error when the network fails and there is no cache", async () => {
    let error: unknown
    try {
      await ensureCatalog({ cachePath, fetchImpl: makeFetchFailing() })
    } catch (e) {
      error = e
    }
    expect(error).toBeInstanceOf(Error)
    expect((error as Error).message).toMatch(/no cached copy/)
  })

  it("treats a malformed cache file as missing", async () => {
    writeFileSync(cachePath, "{ not valid json")
    expect(readCatalog({ cachePath })).toBeNull()
    expect(isCatalogFresh(null, { cachePath })).toBe(false)
  })

  it("loads the cache without touching the network", async () => {
    const catalog: Catalog = parseCatalog(MODELS_DEV_PAYLOAD)!
    writeFileSync(
      cachePath,
      JSON.stringify({ fetchedAt: new Date().toISOString(), providers: catalog.providers }),
    )

    const loaded = loadCatalogOffline({ cachePath })
    expect(loaded?.providers.anthropic!["claude-opus-5-5"]?.name).toBe("Claude Opus 5.5")
  })

  it("returns null from loadCatalogOffline when nothing is cached", () => {
    expect(loadCatalogOffline({ cachePath })).toBeNull()
  })

  it("resolves the active catalog for the process", async () => {
    expect(getActiveCatalog()).toBeNull()
    await ensureCatalog({ cachePath, fetchImpl: makeFetchOk() })
    expect(getActiveCatalog()?.providers.openrouter).toBeDefined()
  })

  it("degrades to unknown rather than failing when the cache is unwritable", async () => {
    const catalog = await fetchCatalog({
      cachePath: join(tempDir, "no", "such", "dir", "as", "a", "file", "x"),
      fetchImpl: makeFetchOk(),
    })
    expect(catalog.providers.openai).toBeDefined()
  })
})