import { describe, expect, it } from "bun:test"
import { PROVIDER_IDS, providerEnvVars } from "@/core/providers"

describe("providerEnvVars", () => {
  it("consults the namespaced override before the Vendor's own variable", () => {
    expect(providerEnvVars("openai")).toEqual([
      "VICODE_OPENAI_API_KEY",
      "OPENAI_API_KEY",
    ])
  })

  it("derives one namespaced name per Provider", () => {
    for (const id of PROVIDER_IDS) {
      const namespaced = providerEnvVars(id).filter((name) => name.startsWith("VICODE_"))
      expect(namespaced).toHaveLength(1)
    }
  })

  it("authenticates both OpenCode routes through one namespaced name", () => {
    expect(providerEnvVars("opencode")).toEqual([
      "VICODE_OPENCODE_API_KEY",
      "OPENCODE_API_KEY",
    ])
    expect(providerEnvVars("opencode-go")).toEqual(providerEnvVars("opencode"))
  })

  it("keeps the legacy OPENROUTER_API_KEY name on the OpenRouter route", () => {
    expect(providerEnvVars("openrouter")).toContain("OPENROUTER_API_KEY")
  })

  it("does not offer one route's variable to another", () => {
    expect(providerEnvVars("openai")).not.toContain("OPENROUTER_API_KEY")
    expect(providerEnvVars("openrouter")).not.toContain("OPENAI_API_KEY")
  })
})
