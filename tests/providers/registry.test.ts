/**
 * The registry's own contract: adding a Provider means adding one entry.
 *
 * Nothing here tests a particular Provider — it tests the claim that the
 * entries in `src/core/providers.ts` are complete enough to build a route
 * from. A half-filled descriptor (no label, no key URL, no transport) is the
 * regression this suite exists to catch, because what it breaks surfaces far
 * from the entry that caused it.
 */
import { describe, expect, it, afterEach, beforeEach } from "bun:test"
import {
  PROVIDER_IDS,
  getProvider,
  listProviders,
  resolveTransport,
  type ProviderDescriptor,
} from "@/core/providers"
import { listCatalogModels, setActiveCatalog } from "@/core/catalog"
import { createProvider } from "@/providers"
import { TEST_CATALOG } from "./harness"

beforeEach(() => {
  setActiveCatalog(TEST_CATALOG)
})

afterEach(() => {
  setActiveCatalog(null)
})

const TRANSPORTS = ["openai-chat", "openai-responses", "anthropic-messages"] as const

describe("registry completeness", () => {
  it("gives every registered id a descriptor, and every descriptor an id", () => {
    // Both directions: an id with no descriptor resolves to nothing at all, and
    // a descriptor whose `id` disagrees with the key it is stored under is
    // invisible to every lookup that goes by id.
    for (const id of PROVIDER_IDS) {
      expect(getProvider(id).id).toBe(id)
    }
    for (const descriptor of listProviders()) {
      expect(PROVIDER_IDS).toContain(descriptor.id)
    }
  })

  it("lists every registered Provider once, in registry order", () => {
    const ids = listProviders().map((p) => p.id)
    expect(ids).toEqual([...PROVIDER_IDS])
    expect(new Set(ids).size).toBe(PROVIDER_IDS.length)
  })

  it("gives every Provider a human label, distinct from every other's", () => {
    const labels = listProviders().map((p) => p.label)
    for (const descriptor of listProviders()) {
      expect(descriptor.label.trim()).not.toBe("")
      expect(descriptor.label).toBe(descriptor.label.trim())
    }
    expect(new Set(labels).size).toBe(labels.length)
  })

  it("tells the user where to get a key for every Provider", () => {
    for (const descriptor of listProviders()) {
      expect(descriptor.keyUrl).toMatch(/^https:\/\//)
    }
  })

  it("names the Vendor's own key variable for every Provider", () => {
    for (const descriptor of listProviders()) {
      expect(descriptor.nativeEnv.length).toBeGreaterThan(0)
      for (const name of descriptor.nativeEnv) {
        expect(name).toMatch(/^[A-Z][A-Z0-9_]*$/)
      }
    }
  })

  it("overrides the SDK base URL with an https one wherever it declares it", () => {
    // The registry can only judge an address it declares; where the address a
    // request actually goes to is pinned is in that route's own adapter suite.
    for (const descriptor of listProviders()) {
      if (descriptor.baseUrl === undefined) continue
      expect(descriptor.baseUrl).toMatch(/^https:\/\//)
      // A trailing slash would double up against the path the SDK appends.
      expect(descriptor.baseUrl.endsWith("/")).toBe(false)
    }
  })

  it("sends no two Providers to the same base URL", () => {
    // Two routes sharing one address are indistinguishable on the wire, so the
    // Provider half of the id would be a claim rather than a fact.
    const overrides = listProviders()
      .map((p) => p.baseUrl)
      .filter((url): url is string => url !== undefined)
    expect(new Set(overrides).size).toBe(overrides.length)
  })

  it("names only transports ViCode has an adapter for", () => {
    for (const descriptor of listProviders()) {
      if (descriptor.transport === null) continue
      expect(TRANSPORTS).toContain(descriptor.transport)
    }
  })

  it("answers a Vendor with its one transport, whatever the Model claims", () => {
    // A Vendor is served by its first-party SDK, which speaks one dialect for
    // everything it sells — so the catalog has no say on the route.
    for (const id of ["openrouter", "openai", "anthropic"] as const) {
      const fixed = getProvider(id).transport
      expect(fixed).not.toBeNull()
      expect(resolveTransport(id, "openai")).toBe(fixed)
      expect(resolveTransport(id, "anthropic")).toBe(fixed)
      expect(resolveTransport(id, "google")).toBe(fixed)
      expect(resolveTransport(id, undefined)).toBe(fixed)
    }
  })

  it("resolves a Gateway's transport from the Model's own protocol", () => {
    // A Gateway reaches several dialects on one credential, so it has no
    // transport of its own to fix.
    for (const id of ["opencode", "opencode-go"] as const) {
      expect(getProvider(id).transport).toBeNull()
      expect(resolveTransport(id, "openai")).toBe("openai-responses")
      expect(resolveTransport(id, "anthropic")).toBe("anthropic-messages")
    }
  })

  it("refuses a Gateway a protocol ViCode has no transport for", () => {
    // Never coerced to a wrong dialect: an unknown wire format is not a
    // licence to guess.
    for (const id of ["opencode", "opencode-go"] as const) {
      expect(resolveTransport(id, "google")).toBeNull()
      expect(resolveTransport(id, "unknown")).toBeNull()
      expect(resolveTransport(id, undefined)).toBeNull()
    }
  })

  it("offers every Provider at least one Model it can actually call", () => {
    for (const descriptor of listProviders()) {
      expect(listCatalogModels(descriptor.id, TEST_CATALOG).length).toBeGreaterThan(0)
    }
  })

  it("builds a Provider from every registry entry, through the one factory", () => {
    for (const descriptor of listProviders()) {
      const provider = createProvider({ model: aReachableModel(descriptor), apiKey: "test-key" })

      expect(typeof provider.streamChat).toBe("function")
      expect(typeof provider.summarize).toBe("function")
      expect(typeof provider.getModelInfo).toBe("function")
      expect(typeof provider.listModels).toBe("function")
    }
  })

  it("routes every Provider back to the entry it was built from", () => {
    for (const descriptor of listProviders()) {
      const provider = createProvider({ model: aReachableModel(descriptor), apiKey: "test-key" })
      const info = provider.getModelInfo()

      expect(info.provider).toBe(descriptor.id)
      expect(info.id).toBe(aReachableModel(descriptor))
    }
  })
})

/** A canonical id on `descriptor` ViCode can reach, read from the fixture catalog. */
function aReachableModel(descriptor: ProviderDescriptor): string {
  const reachable = listCatalogModels(descriptor.id, TEST_CATALOG)
  const model = reachable[0]
  if (!model) throw new Error(`No reachable model on ${descriptor.id}`)
  return `${descriptor.id}/${model.id}`
}