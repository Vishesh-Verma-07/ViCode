import { describe, it, expect } from "bun:test"
import { routeLabel } from "@/ui/route-label"

describe("routeLabel", () => {
  it("names the Provider and the Model together, so a Model never reads as the whole route", () => {
    expect(
      routeLabel({
        id: "openrouter/anthropic/claude-opus-5-5",
        name: "anthropic/claude-opus-5-5",
        provider: "openrouter",
        contextLength: 200_000,
      }),
    ).toBe("openrouter/anthropic/claude-opus-5-5")
  })

  it("keeps one Model on two Providers distinguishable", () => {
    const shared = { name: "claude-opus-5-5", contextLength: null }
    const direct = routeLabel({ ...shared, id: "anthropic/claude-opus-5-5", provider: "anthropic" })
    const gateway = routeLabel({ ...shared, id: "opencode/claude-opus-5-5", provider: "opencode" })
    expect(direct).not.toBe(gateway)
    expect(direct).toBe("anthropic/claude-opus-5-5")
    expect(gateway).toBe("opencode/claude-opus-5-5")
  })

  it("qualifies an unqualified id with the Provider that served it", () => {
    expect(
      routeLabel({ id: "claude-opus-5-5", name: "claude-opus-5-5", provider: "openai", contextLength: null }),
    ).toBe("openai/claude-opus-5-5")
  })

  it("shows an id alone when nothing says which Provider serves it", () => {
    expect(
      routeLabel({ id: "claude-opus-5-5", name: "claude-opus-5-5", contextLength: null }),
    ).toBe("claude-opus-5-5")
  })

  it("reads a Model carrying no id by its name rather than by an empty route", () => {
    expect(routeLabel({ id: "", name: "mystery-model", contextLength: null })).toBe("mystery-model")
  })

  it("leaves an unknown prefix alone instead of naming a Provider that does not exist", () => {
    expect(
      routeLabel({ id: "acme-ai/claude-opus-5-5", name: "claude-opus-5-5", contextLength: null }),
    ).toBe("acme-ai/claude-opus-5-5")
  })
})