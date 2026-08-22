import { describe, it, expect } from "bun:test"
import { createModelCommand, formatModelPricing } from "./model"
import type { CommandContext, PickerRequest } from "../core/types"
import type { ModelListing } from "../core/provider"

const freeModel: ModelListing = {
  id: "free/model-a",
  name: "Model A (free)",
  pricing: { kind: "free" },
}

const paidModel: ModelListing = {
  id: "paid/model-b",
  name: "Model B",
  pricing: { kind: "paid", inputPricePerToken: 3 / 1_000_000, outputPricePerToken: 15 / 1_000_000 },
}

const cheapPaidModel: ModelListing = {
  id: "paid/model-c",
  name: "Model C",
  pricing: { kind: "paid", inputPricePerToken: 0, outputPricePerToken: 0.6 / 1_000_000 },
}

function createContext(opts: {
  models?: ModelListing[]
  currentModelId?: string
  pickerResult: number | null
}): {
  context: CommandContext
  pickerRequests: PickerRequest[]
  switchedTo: string[]
} {
  const pickerRequests: PickerRequest[] = []
  const switchedTo: string[] = []
  const models = opts.models ?? []
  const currentModelId = opts.currentModelId ?? ""
  return {
    pickerRequests,
    switchedTo,
    context: {
      projectPath: "/tmp/project",
      openPicker: async (request) => {
        pickerRequests.push(request)
        return opts.pickerResult
      },
      models: {
        list: async () => models,
        getCurrentModelId: () => currentModelId,
        switchTo: (modelId) => switchedTo.push(modelId),
      },
    },
  }
}

describe("formatModelPricing", () => {
  it("labels free models as free", () => {
    expect(formatModelPricing({ kind: "free" })).toBe("free")
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
    const { context, pickerRequests, switchedTo } = createContext({ models: [], pickerResult: null })

    const output = await command.execute([], context)

    expect(output).toContain("No models available")
    expect(pickerRequests).toHaveLength(0)
    expect(switchedTo).toHaveLength(0)
  })

  it("opens the picker populated with fetched models, each labelled free or with its pricing", async () => {
    const command = createModelCommand()
    const { context, pickerRequests } = createContext({
      models: [freeModel, paidModel],
      pickerResult: null,
    })

    await command.execute([], context)

    expect(pickerRequests).toHaveLength(1)
    const request = pickerRequests[0]!
    expect(request.items.map((i) => i.label)).toEqual(["Model A (free)", "Model B"])
    expect(request.items[0]!.metadata).toContain("free")
    expect(request.items[1]!.metadata).toContain("paid/model-b")
    expect(request.items[1]!.metadata).toContain("$3.00/M")
    expect(request.items[1]!.metadata).toContain("$15.00/M")
  })

  it("marks the currently active model in the listing", async () => {
    const command = createModelCommand()
    const { context, pickerRequests } = createContext({
      models: [paidModel, cheapPaidModel],
      currentModelId: "paid/model-c",
      pickerResult: null,
    })

    await command.execute([], context)

    const request = pickerRequests[0]!
    expect(request.items[1]!.label).toContain("current")
    expect(request.items[0]!.label).not.toContain("current")
  })

  it("switches to the chosen model and confirms", async () => {
    const command = createModelCommand()
    const { context, switchedTo } = createContext({
      models: [freeModel, paidModel],
      currentModelId: "free/model-a",
      pickerResult: 1,
    })

    const output = await command.execute([], context)

    expect(switchedTo).toEqual(["paid/model-b"])
    expect(output).toContain("paid/model-b")
  })

  it("changes nothing when the picker is cancelled", async () => {
    const command = createModelCommand()
    const { context, switchedTo } = createContext({
      models: [freeModel, paidModel],
      pickerResult: null,
    })

    const output = await command.execute([], context)

    expect(output).toBe("")
    expect(switchedTo).toHaveLength(0)
  })

  it("does not recreate the provider when the selected model is already active", async () => {
    const command = createModelCommand()
    const { context, switchedTo } = createContext({
      models: [freeModel, paidModel],
      currentModelId: "paid/model-b",
      pickerResult: 1,
    })

    const output = await command.execute([], context)

    expect(switchedTo).toHaveLength(0)
    expect(output).toContain("Already using")
    expect(output).toContain("paid/model-b")
  })

  it("propagates listing failures so they surface as feedback", async () => {
    const command = createModelCommand()
    const context: CommandContext = {
      projectPath: "/tmp/project",
      openPicker: async () => null,
      models: {
        list: async () => {
          throw new Error("no cache available")
        },
        getCurrentModelId: () => "x",
        switchTo: () => {},
      },
    }

    await expect(command.execute([], context)).rejects.toThrow(/no cache available/)
  })

  it("throws a helpful error when interactive capabilities are missing", async () => {
    const command = createModelCommand()
    await expect(command.execute([], { projectPath: "/tmp/project" })).rejects.toThrow(/interactive/)
  })
})
