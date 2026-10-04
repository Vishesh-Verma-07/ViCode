import { describe, it, expect } from "bun:test"
import { createModelCommand, createProviderCommand, formatContextWindow, formatModelPricing } from "@/commands/model"
import type {
  CommandContext,
  ModelSwitchResult,
  PickerRequest,
  ProviderOffering,
} from "@/core/types"
import type { ModelListing } from "@/core/provider"
import type { ProviderId } from "@/core/providers"

const freeModel: ModelListing = {
  id: "nvidia/nemotron-3-ultra-550b-a55b:free",
  name: "Nemotron 3 Ultra (free)",
  pricing: { kind: "free" },
  contextLength: 128_000,
}

const paidModel: ModelListing = {
  id: "claude-sonnet-4",
  name: "Claude Sonnet 4",
  pricing: { kind: "paid", inputPricePerToken: 3 / 1_000_000, outputPricePerToken: 15 / 1_000_000 },
  contextLength: 200_000,
}

const cheapPaidModel: ModelListing = {
  id: "gpt-5.3-codex",
  name: "GPT-5.3 Codex",
  pricing: { kind: "paid", inputPricePerToken: 0, outputPricePerToken: 0.6 / 1_000_000 },
  contextLength: null,
}

const unpricedModel: ModelListing = {
  id: "mystery-model",
  name: "Mystery Model",
  pricing: { kind: "unknown" },
  contextLength: null,
}

function offering(overrides: Partial<ProviderOffering> & { provider: ProviderId }): ProviderOffering {
  return {
    label: overrides.provider,
    kind: "vendor",
    models: [],
    hasKey: true,
    ...overrides,
  }
}

const OPENROUTER = offering({
  provider: "openrouter",
  label: "OpenRouter",
  kind: "gateway",
  billingNote: "pay per token",
  models: [freeModel, paidModel],
})

const ANTHROPIC = offering({
  provider: "anthropic",
  label: "Anthropic",
  models: [cheapPaidModel, unpricedModel],
  hasKey: false,
})

function createContext(opts: {
  offerings?: ProviderOffering[]
  currentModelId?: string
  currentProvider?: ProviderId
  pickerResult: number | null
  listError?: Error
  /** What the host reports back from the switch. Defaults to a success. */
  switchResult?: ModelSwitchResult
}): {
  context: CommandContext
  pickerRequests: PickerRequest[]
  switchRequests: string[]
} {
  const pickerRequests: PickerRequest[] = []
  const switchRequests: string[] = []
  const offerings = opts.offerings ?? []
  const currentModelId = opts.currentModelId ?? ""
  return {
    pickerRequests,
    switchRequests,
    context: {
      projectPath: "/tmp/project",
      openPicker: async (request) => {
        pickerRequests.push(request)
        return opts.pickerResult
      },
      models: {
        listProviders: async () => {
          if (opts.listError) throw opts.listError
          return offerings
        },
        getCurrentModelId: () => currentModelId,
        getCurrentProvider: () => opts.currentProvider ?? "openrouter",
        switchTo: async (modelId) => {
          switchRequests.push(modelId)
          return opts.switchResult ?? { kind: "switched", modelId }
        },
      },
    },
  }
}

describe("formatModelPricing", () => {
  it("labels free models as free", () => {
    expect(formatModelPricing({ kind: "free" })).toBe("free")
  })

  it("labels an unpriced model as unknown, never as free", () => {
    const meta = formatModelPricing({ kind: "unknown" })
    expect(meta).toBe("—")
    expect(meta).not.toBe(formatModelPricing({ kind: "free" }))
  })

  it("shows per-million-token rates for paid models", () => {
    const meta = formatModelPricing({
      kind: "paid",
      inputPricePerToken: 3 / 1_000_000,
      outputPricePerToken: 15 / 1_000_000,
    })
    expect(meta).toContain("$3.00/M")
    expect(meta).toContain("$15.00/M")
  })

  it("keeps cheap paid models distinguishable from free", () => {
    const meta = formatModelPricing({
      kind: "paid",
      inputPricePerToken: 0,
      outputPricePerToken: 0.6 / 1_000_000,
    })
    expect(meta).not.toBe("free")
    expect(meta).toContain("$0.60")
  })

  it("does not collapse sub-cent per-million rates to zero", () => {
    const meta = formatModelPricing({
      kind: "paid",
      inputPricePerToken: 0,
      outputPricePerToken: 1e-9,
    })
    expect(meta).not.toBe("free")
    expect(meta).toContain("$0.001/M")
  })
})

describe("createModelCommand", () => {
  it("is named model with a description", () => {
    const command = createModelCommand()
    expect(command.name).toBe("model")
    expect(typeof command.description).toBe("string")
    expect(command.description.length).toBeGreaterThan(0)
  })

  it("reports when no models are available without opening the picker", async () => {
    const command = createModelCommand()
    const { context, pickerRequests, switchRequests } = createContext({
      offerings: [offering({ provider: "opencode-go" })],
      pickerResult: null,
    })

    const output = await command.execute([], context)

    expect(output).toContain("No models available")
    expect(pickerRequests).toHaveLength(0)
    expect(switchRequests).toHaveLength(0)
  })

  it("groups models under a heading per Provider", async () => {
    const command = createModelCommand()
    const { context, pickerRequests } = createContext({
      offerings: [OPENROUTER, ANTHROPIC],
      pickerResult: null,
    })

    await command.execute([], context)

    expect(pickerRequests).toHaveLength(1)
    const labels = pickerRequests[0]!.items.map((i) => i.label)
    // heading, two models, heading, two models
    expect(labels).toEqual([
      "OpenRouter",
      "Nemotron 3 Ultra (free)",
      "Claude Sonnet 4",
      "Anthropic",
      "GPT-5.3 Codex",
      "Mystery Model",
    ])
  })

  it("shows the canonical provider-qualified id for each model", async () => {
    const command = createModelCommand()
    const { context, pickerRequests } = createContext({
      offerings: [OPENROUTER, ANTHROPIC],
      pickerResult: null,
    })

    await command.execute([], context)

    const items = pickerRequests[0]!.items
    expect(items[1]!.metadata).toContain("openrouter/nvidia/nemotron-3-ultra-550b-a55b:free")
    expect(items[4]!.metadata).toContain("anthropic/gpt-5.3-codex")
  })

  it("labels each model free or with its pricing", async () => {
    const command = createModelCommand()
    const { context, pickerRequests } = createContext({
      offerings: [OPENROUTER],
      pickerResult: null,
    })

    await command.execute([], context)

    const items = pickerRequests[0]!.items
    expect(items[1]!.metadata).toContain("free")
    expect(items[2]!.metadata).toContain("$3.00/M")
    expect(items[2]!.metadata).toContain("$15.00/M")
  })

  it("shows an unpriced model as a dash, so it cannot be picked as if it were free", async () => {
    const command = createModelCommand()
    const { context, pickerRequests } = createContext({
      offerings: [ANTHROPIC],
      pickerResult: null,
    })

    await command.execute([], context)

    const items = pickerRequests[0]!.items
    expect(items[2]!.metadata).toContain("anthropic/mystery-model · —")
    expect(items[2]!.metadata).not.toContain("free")
  })

  it("shows each model's context window, so a 32k model is not picked as a 200k one", async () => {
    const command = createModelCommand()
    const { context, pickerRequests } = createContext({
      offerings: [OPENROUTER],
      pickerResult: null,
    })

    await command.execute([], context)

    const items = pickerRequests[0]!.items
    expect(items[1]!.metadata).toContain("128.0k ctx")
    expect(items[2]!.metadata).toContain("200.0k ctx")
  })

  it("shows an unmeasured context window as a dash, never as a window it guessed", async () => {
    const command = createModelCommand()
    const { context, pickerRequests } = createContext({
      offerings: [ANTHROPIC],
      pickerResult: null,
    })

    await command.execute([], context)

    const items = pickerRequests[0]!.items
    expect(items[1]!.metadata).toContain("— ctx")
    expect(items[1]!.metadata).not.toContain("0.0k")
    // The dash must read as "nobody has published a window", not as a number.
    expect(formatContextWindow(null)).not.toBe(formatContextWindow(0))
  })

  it("marks a Provider with no key rather than hiding its models", async () => {
    const command = createModelCommand()
    const { context, pickerRequests } = createContext({
      offerings: [ANTHROPIC],
      pickerResult: null,
    })

    await command.execute([], context)

    expect(pickerRequests[0]!.items[1]!.metadata).toContain("no key")
  })

  it("describes each Provider's billing", async () => {
    const command = createModelCommand()
    const { context, pickerRequests } = createContext({
      offerings: [OPENROUTER, ANTHROPIC],
      pickerResult: null,
    })

    await command.execute([], context)

    const items = pickerRequests[0]!.items
    // A gateway shows what it charges for; a vendor is just marked first-party.
    expect(items[0]!.metadata).toContain("pay per token")
    expect(items[3]!.metadata).toContain("first-party")
  })

  it("marks the currently active model", async () => {
    const command = createModelCommand()
    const { context, pickerRequests } = createContext({
      offerings: [OPENROUTER],
      currentModelId: "openrouter/claude-sonnet-4",
      pickerResult: null,
    })

    await command.execute([], context)

    const items = pickerRequests[0]!.items
    expect(items[2]!.label).toContain("current")
    expect(items[1]!.label).not.toContain("current")
  })

  it("switches to the chosen model with its Provider prefix", async () => {
    const command = createModelCommand()
    const { context, switchRequests } = createContext({
      offerings: [OPENROUTER, ANTHROPIC],
      currentModelId: "openrouter/nvidia/nemotron-3-ultra-550b-a55b:free",
      pickerResult: 4,
    })

    const output = await command.execute([], context)

    expect(switchRequests).toEqual(["anthropic/gpt-5.3-codex"])
    expect(output).toContain("anthropic/gpt-5.3-codex")
  })

  it("changes nothing when the picker is cancelled", async () => {
    const command = createModelCommand()
    const { context, switchRequests } = createContext({
      offerings: [OPENROUTER],
      pickerResult: null,
    })

    const output = await command.execute([], context)

    expect(output).toBe("")
    expect(switchRequests).toHaveLength(0)
  })

  it("treats selecting a Provider heading as a no-op", async () => {
    const command = createModelCommand()
    const { context, switchRequests } = createContext({
      offerings: [OPENROUTER],
      pickerResult: 0,
    })

    const output = await command.execute([], context)

    expect(switchRequests).toHaveLength(0)
    expect(output).toBe("")
  })

  it("does not recreate the provider when the selected model is already active", async () => {
    const command = createModelCommand()
    const { context, switchRequests } = createContext({
      offerings: [OPENROUTER],
      currentModelId: "openrouter/claude-sonnet-4",
      pickerResult: 2,
    })

    const output = await command.execute([], context)

    expect(switchRequests).toHaveLength(0)
    expect(output).toContain("Already using")
    expect(output).toContain("openrouter/claude-sonnet-4")
  })

  it("propagates listing failures so they surface as feedback", async () => {
    const command = createModelCommand()
    const { context } = createContext({
      pickerResult: null,
      listError: new Error("no cache available"),
    })

    await expect(command.execute([], context)).rejects.toThrow(/no cache available/)
  })

  it("reports the missing key rather than a switch that did not happen", async () => {
    const command = createModelCommand()
    const { context, switchRequests } = createContext({
      offerings: [OPENROUTER, ANTHROPIC],
      currentModelId: "openrouter/claude-sonnet-4",
      pickerResult: 4,
      switchResult: { kind: "needs-key", provider: "anthropic" },
    })

    const output = await command.execute([], context)

    expect(switchRequests).toEqual(["anthropic/gpt-5.3-codex"])
    expect(output).toBe("No API key for Anthropic. Set one with /key anthropic.")
  })

  it("reports why a switch was refused", async () => {
    const command = createModelCommand()
    const { context } = createContext({
      offerings: [OPENROUTER, ANTHROPIC],
      currentModelId: "openrouter/claude-sonnet-4",
      pickerResult: 4,
      switchResult: { kind: "refused", reason: "anthropic/gpt-5.3-codex cannot be reached." },
    })

    const output = await command.execute([], context)

    expect(output).toBe("anthropic/gpt-5.3-codex cannot be reached.")
  })

  it("confirms the model the host reports, not the one it asked for", async () => {
    const command = createModelCommand()
    const { context } = createContext({
      offerings: [OPENROUTER, ANTHROPIC],
      currentModelId: "openrouter/claude-sonnet-4",
      pickerResult: 4,
      switchResult: { kind: "switched", modelId: "anthropic/gpt-5.3-codex-preview" },
    })

    const output = await command.execute([], context)

    expect(output).toBe("Switched to anthropic/gpt-5.3-codex-preview")
  })

  it("throws a helpful error when interactive capabilities are missing", async () => {
    const command = createModelCommand()
    await expect(command.execute([], { projectPath: "/tmp/project" })).rejects.toThrow(/interactive/)
  })
})

describe("createProviderCommand", () => {
  function providerContext(opts: {
    offerings?: ProviderOffering[]
    current?: ProviderId
    pickerResult: number | null
    /** What the host reports back from the switch. Defaults to a success. */
    switchResult?: ModelSwitchResult
  }) {
    const pickerRequests: PickerRequest[] = []
    const switchRequests: ProviderId[] = []
    const offerings = opts.offerings ?? [OPENROUTER, ANTHROPIC]
    const context: CommandContext = {
      projectPath: "/tmp/project",
      openPicker: async (request) => {
        pickerRequests.push(request)
        return opts.pickerResult
      },
      providers: {
        list: async () => offerings,
        getCurrent: () => opts.current ?? "openrouter",
        switchTo: async (provider) => {
          switchRequests.push(provider)
          return opts.switchResult ?? { kind: "switched", modelId: "anthropic/gpt-5.3-codex" }
        },
      },
    }
    return { context, pickerRequests, switchRequests }
  }

  it("is named provider with a description", () => {
    const command = createProviderCommand()
    expect(command.name).toBe("provider")
    expect(command.description.length).toBeGreaterThan(0)
  })

  it("lists every Provider with its model count", async () => {
    const command = createProviderCommand()
    const { context, pickerRequests } = providerContext({ pickerResult: null })

    await command.execute([], context)

    const items = pickerRequests[0]!.items
    expect(items.map((i) => i.label)).toEqual(["OpenRouter (current)", "Anthropic"])
    expect(items[0]!.metadata).toContain("2 models")
    expect(items[1]!.metadata).toContain("2 models")
  })

  it("marks a Provider with no key", async () => {
    const command = createProviderCommand()
    const { context, pickerRequests } = providerContext({ pickerResult: null })

    await command.execute([], context)

    expect(pickerRequests[0]!.items[1]!.metadata).toContain("no key")
  })

  it("switches Provider and reports the model it landed on", async () => {
    const command = createProviderCommand()
    const { context, switchRequests } = providerContext({ pickerResult: 1 })

    const output = await command.execute([], context)

    expect(switchRequests).toEqual(["anthropic"])
    expect(output).toContain("Anthropic")
    expect(output).toContain("anthropic/gpt-5.3-codex")
  })

  it("names the missing key when the Provider has none", async () => {
    const command = createProviderCommand()
    const { context } = providerContext({
      pickerResult: 1,
      switchResult: { kind: "needs-key", provider: "anthropic" },
    })

    const output = await command.execute([], context)

    expect(output).toBe("No API key for Anthropic. Set one with /key anthropic.")
  })

  it("explains when the Provider cannot be switched to", async () => {
    const command = createProviderCommand()
    const { context } = providerContext({
      pickerResult: 1,
      switchResult: { kind: "refused", reason: "Anthropic has no models ViCode can call." },
    })

    const output = await command.execute([], context)

    expect(output).toBe("Anthropic has no models ViCode can call.")
  })

  it("changes nothing when the picker is cancelled", async () => {
    const command = createProviderCommand()
    const { context, switchRequests } = providerContext({ pickerResult: null })

    const output = await command.execute([], context)

    expect(output).toBe("")
    expect(switchRequests).toHaveLength(0)
  })

  it("does not switch when the current Provider is chosen", async () => {
    const command = createProviderCommand()
    const { context, switchRequests } = providerContext({ pickerResult: 0 })

    const output = await command.execute([], context)

    expect(switchRequests).toHaveLength(0)
    expect(output).toContain("Already using")
  })

  it("throws a helpful error when interactive capabilities are missing", async () => {
    const command = createProviderCommand()
    await expect(command.execute([], { projectPath: "/tmp/project" })).rejects.toThrow(/interactive/)
  })
})