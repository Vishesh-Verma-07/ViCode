import { describe, it, expect } from "bun:test"
import {
  parseModelId,
  formatModelId,
  resolveModelId,
  LEGACY_PROVIDER,
  QUALIFIED_MODEL_FORMAT_VERSION,
  isLegacyModelValue,
  qualifyStoredModel,
} from "@/core/model-id"

describe("parseModelId", () => {
  it("splits a simple qualified id", () => {
    expect(parseModelId("openai/gpt-5.3-codex")).toEqual({
      provider: "openai",
      model: "gpt-5.3-codex",
    })
  })

  it("splits on the FIRST slash so OpenRouter's own slashes survive", () => {
    expect(
      parseModelId("openrouter/nvidia/nemotron-3-ultra-550b-a55b:free"),
    ).toEqual({
      provider: "openrouter",
      model: "nvidia/nemotron-3-ultra-550b-a55b:free",
    })
  })

  it("splits on the first slash for a gateway model with an embedded vendor", () => {
    expect(parseModelId("opencode/anthropic/claude-sonnet-4")).toEqual({
      provider: "opencode",
      model: "anthropic/claude-sonnet-4",
    })
  })

  it("returns provider: null for an unqualified id", () => {
    expect(parseModelId("gpt-4o")).toEqual({ provider: null, model: "gpt-4o" })
  })

  it("reads a vendor-prefixed id as that Provider", () => {
    // Ambiguous by construction: `anthropic/...` is both an OpenRouter id and
    // the canonical id for the Anthropic Provider. Stored data is disambiguated
    // by format version in qualifyStoredModel, not here.
    expect(parseModelId("anthropic/claude-sonnet-4")).toEqual({
      provider: "anthropic",
      model: "claude-sonnet-4",
    })
  })

  it("returns provider: null for an unknown provider prefix", () => {
    expect(parseModelId("google/gemini-3-pro")).toEqual({
      provider: null,
      model: "google/gemini-3-pro",
    })
  })

  it("returns provider: null for an id with no model after the prefix", () => {
    expect(parseModelId("openai/")).toEqual({ provider: null, model: "openai/" })
  })

  it("returns provider: null for a leading slash", () => {
    expect(parseModelId("/gpt-4o")).toEqual({ provider: null, model: "/gpt-4o" })
  })

  it("trims surrounding whitespace", () => {
    expect(parseModelId("  openai/gpt-5.3-codex  ")).toEqual({
      provider: "openai",
      model: "gpt-5.3-codex",
    })
  })

  it("handles every registered provider", () => {
    for (const id of ["openrouter", "openai", "anthropic", "opencode", "opencode-go"] as const) {
      expect(parseModelId(`${id}/some-model`).provider).toBe(id)
    }
  })
})

describe("formatModelId", () => {
  it("builds a canonical id", () => {
    expect(formatModelId("openai", "gpt-5.3-codex")).toBe("openai/gpt-5.3-codex")
  })

  it("does not escape slashes already in the model id", () => {
    expect(formatModelId("openrouter", "nvidia/nemotron:free")).toBe(
      "openrouter/nvidia/nemotron:free",
    )
  })

  it("round-trips through parseModelId", () => {
    const canonical = formatModelId("opencode-go", "grok-code")
    expect(parseModelId(canonical)).toEqual({ provider: "opencode-go", model: "grok-code" })
  })
})

describe("resolveModelId", () => {
  it("passes through an already-qualified id", () => {
    expect(resolveModelId("anthropic/claude-opus-5-5")).toEqual({
      provider: "anthropic",
      model: "claude-opus-5-5",
    })
  })

  it("treats an ambiguous vendor prefix as that Provider", () => {
    expect(resolveModelId("openai/gpt-4o")).toEqual({ provider: "openai", model: "gpt-4o" })
  })

  it("treats a bare id as OpenRouter", () => {
    expect(resolveModelId("gpt-4o")).toEqual({ provider: "openrouter", model: "gpt-4o" })
  })

  it("treats an unknown prefix as an OpenRouter model id", () => {
    expect(resolveModelId("google/gemini-3-pro")).toEqual({
      provider: "openrouter",
      model: "google/gemini-3-pro",
    })
  })

  it("migrates the legacy default model id", () => {
    expect(resolveModelId("nvidia/nemotron-3-ultra-550b-a55b:free")).toEqual({
      provider: LEGACY_PROVIDER,
      model: "nvidia/nemotron-3-ultra-550b-a55b:free",
    })
  })
})

describe("isLegacyModelValue", () => {
  it("is true when the format marker is absent", () => {
    expect(isLegacyModelValue({ model: "openai/gpt-4o" })).toBe(true)
  })

  it("is true when the marker names a different format", () => {
    expect(isLegacyModelValue({ modelFormatVersion: 1 })).toBe(true)
  })

  it("is false at the current format", () => {
    expect(isLegacyModelValue({ modelFormatVersion: QUALIFIED_MODEL_FORMAT_VERSION })).toBe(false)
  })

  it("reads the marker's original field name, so a session is not called legacy", () => {
    // The current release wrote the marker as `version`. Renaming the field
    // without reading it would make every such session look pre-qualification,
    // and its Anthropic Model would be re-pointed at OpenRouter (issue #86).
    expect(isLegacyModelValue({ version: QUALIFIED_MODEL_FORMAT_VERSION })).toBe(false)
  })

  it("still calls a stale marker under the original name legacy", () => {
    expect(isLegacyModelValue({ version: 1 })).toBe(true)
  })

  it("prefers the current field name when a container carries both", () => {
    expect(isLegacyModelValue({ modelFormatVersion: QUALIFIED_MODEL_FORMAT_VERSION, version: 1 })).toBe(
      false,
    )
    expect(isLegacyModelValue({ modelFormatVersion: 1, version: QUALIFIED_MODEL_FORMAT_VERSION })).toBe(
      true,
    )
  })

  it("is true for a non-object", () => {
    expect(isLegacyModelValue(null)).toBe(true)
    expect(isLegacyModelValue("openai/gpt-4o")).toBe(true)
  })
})

describe("qualifyStoredModel", () => {
  it("prefixes legacy data with openrouter even when the prefix is a vendor name", () => {
    // The collision this whole mechanism exists for: read as a Provider id,
    // `openai/gpt-4o` would silently move the session off OpenRouter.
    expect(qualifyStoredModel("openai/gpt-4o", true)).toBe("openrouter/openai/gpt-4o")
    expect(qualifyStoredModel("anthropic/claude-sonnet-4", true)).toBe(
      "openrouter/anthropic/claude-sonnet-4",
    )
  })

  it("prefixes a bare legacy id", () => {
    expect(qualifyStoredModel("nvidia/nemotron-3-ultra-550b-a55b:free", true)).toBe(
      "openrouter/nvidia/nemotron-3-ultra-550b-a55b:free",
    )
    expect(qualifyStoredModel("gpt-4o", true)).toBe("openrouter/gpt-4o")
  })

  it("does not double-prefix legacy data that was already migrated", () => {
    expect(qualifyStoredModel("openrouter/openai/gpt-4o", true)).toBe(
      "openrouter/openrouter/openai/gpt-4o",
    )
  })

  it("reads a current-format id as the Provider it names", () => {
    expect(qualifyStoredModel("openai/gpt-5.3-codex", false)).toBe("openai/gpt-5.3-codex")
    expect(qualifyStoredModel("anthropic/claude-opus-5-5", false)).toBe(
      "anthropic/claude-opus-5-5",
    )
    expect(qualifyStoredModel("openrouter/anthropic/claude-sonnet-4", false)).toBe(
      "openrouter/anthropic/claude-sonnet-4",
    )
  })

  it("leaves unresolvable current-format input alone", () => {
    expect(qualifyStoredModel("google/gemini-3-pro", false)).toBe("google/gemini-3-pro")
    expect(qualifyStoredModel("gpt-4o", false)).toBe("gpt-4o")
  })

  it("returns empty for a missing value", () => {
    expect(qualifyStoredModel(undefined, false)).toBe("")
    expect(qualifyStoredModel("   ", true)).toBe("")
  })

  it("trims whitespace", () => {
    expect(qualifyStoredModel("  gpt-4o  ", true)).toBe("openrouter/gpt-4o")
  })
})
