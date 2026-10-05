import { describe, it, expect } from "bun:test"
import { convertMessages, convertTools, createOpenRouterProvider } from "@/providers/openrouter"
import { createProvider, UnsupportedModelError, UnknownProviderError } from "@/providers"
import type { Message, ToolDefinition } from "@/core/types"
import { z } from "zod"

describe("createOpenRouterProvider", () => {
  it("reports the model as a canonical, provider-qualified id", () => {
    const provider = createOpenRouterProvider({
      apiKey: "test-key",
      model: "anthropic/claude-sonnet-4",
    })
    const info = provider.getModelInfo()
    expect(info.id).toBe("openrouter/anthropic/claude-sonnet-4")
    expect(info.provider).toBe("openrouter")
  })

  it("exposes streamChat, summarize and listModels", () => {
    const provider = createOpenRouterProvider({ apiKey: "test-key", model: "openai/gpt-4o" })
    expect(typeof provider.streamChat).toBe("function")
    expect(typeof provider.summarize).toBe("function")
    expect(typeof provider.listModels).toBe("function")
  })
})

describe("createProvider", () => {
  it("rejects a model id with no provider prefix", () => {
    expect(() => createProvider({ model: "gpt-4o", apiKey: "k" })).toThrow(
      /not provider-qualified/,
    )
  })

  it("rejects a canonical id with no model after the prefix", () => {
    // A prefix on its own names no Model, so there is nothing to build. Reading
    // it as a Model would bill an empty model id rather than say so.
    expect(() => createProvider({ model: "openai/", apiKey: "k" })).toThrow(/names no Model/)
  })

  it("trims whitespace around a canonical id", () => {
    // One parser owns the rule, so an id copied with a stray space resolves
    // rather than reading ` openai` as a Provider outside the registry.
    const provider = createProvider({ model: " openai/gpt-5.3-codex ", apiKey: "k" })
    expect(provider.getModelInfo().id).toBe("openai/gpt-5.3-codex")
  })

  it("routes OpenRouter through its own SDK", () => {
    const provider = createProvider({ model: "openrouter/openai/gpt-4o", apiKey: "k" })
    expect(provider.getModelInfo().id).toBe("openrouter/openai/gpt-4o")
  })

  it("routes the Providers with a fixed transport without needing the catalog", () => {
    for (const [model, expected] of [
      ["openai/gpt-5.3-codex", "openai"],
      ["anthropic/claude-opus-5-5", "anthropic"],
    ] as const) {
      const provider = createProvider({ model, apiKey: "k" })
      expect(provider.getModelInfo().provider).toBe(expected)
    }
  })

  it("needs the catalog to route the gateways, which speak per-model protocols", () => {
    // Zen and Go have no single transport: with no catalog loaded there is no
    // way to know which wire format a given model wants, so this must fail
    // loudly rather than guess a dialect.
    expect(() => createProvider({ model: "opencode/claude-sonnet-4", apiKey: "k" })).toThrow(
      UnsupportedModelError,
    )
    expect(() => createProvider({ model: "opencode-go/grok-code", apiKey: "k" })).toThrow(
      UnsupportedModelError,
    )
  })

  it("throws UnsupportedModelError when the catalog has no protocol for the model", () => {
    expect(() => createProvider({ model: "opencode/gemini-3-pro", apiKey: "k" })).toThrow(
      UnsupportedModelError,
    )
  })

  it("throws UnknownProviderError for a provider that is not in the registry", () => {
    expect(() => createProvider({ model: "google/gemini-3-pro", apiKey: "k" })).toThrow(
      UnknownProviderError,
    )
    expect(() => createProvider({ model: "google/gemini-3-pro", apiKey: "k" })).toThrow(
      /not a known Provider/,
    )
  })
})

describe("convertMessages", () => {
  it("converts system message", () => {
    const messages: Message[] = [
      {
        id: "1",
        role: "system",
        content: [{ type: "text", text: "You are helpful." }],
        timestamp: Date.now(),
      },
    ]
    const result = convertMessages(messages)
    expect(result).toEqual([{ role: "system", content: "You are helpful." }])
  })

  it("converts user message", () => {
    const messages: Message[] = [
      {
        id: "1",
        role: "user",
        content: [{ type: "text", text: "Hello" }],
        timestamp: Date.now(),
      },
    ]
    const result = convertMessages(messages)
    expect(result).toEqual([{ role: "user", content: "Hello" }])
  })

  it("converts assistant message with text", () => {
    const messages: Message[] = [
      {
        id: "1",
        role: "assistant",
        content: [{ type: "text", text: "Hi there" }],
        timestamp: Date.now(),
      },
    ]
    const result = convertMessages(messages)
    expect(result).toEqual([
      { role: "assistant", content: [{ type: "text", text: "Hi there" }] },
    ])
  })

  it("converts assistant message with tool calls", () => {
    const messages: Message[] = [
      {
        id: "1",
        role: "assistant",
        content: [
          { type: "text", text: "Let me check." },
          { type: "tool-call", toolCallId: "call_1", toolName: "read_file", args: { path: "foo.ts" } },
        ],
        timestamp: Date.now(),
      },
    ]
    const result = convertMessages(messages)
    expect(result).toEqual([
      {
        role: "assistant",
        content: [
          { type: "text", text: "Let me check." },
          { type: "tool-call", toolCallId: "call_1", toolName: "read_file", input: { path: "foo.ts" } },
        ],
      },
    ])
  })

  it("converts tool result message", () => {
    const messages: Message[] = [
      {
        id: "1",
        role: "tool",
        content: [
          { type: "tool-result", toolCallId: "call_1", toolName: "read_file", result: "file contents" },
        ],
        timestamp: Date.now(),
      },
    ]
    const result = convertMessages(messages)
    expect(result).toEqual([
      {
        role: "tool",
        content: [
          { type: "tool-result", toolCallId: "call_1", toolName: "read_file", output: { type: "text", value: "file contents" } },
        ],
      },
    ])
  })

  it("converts multi-turn conversation", () => {
    const messages: Message[] = [
      { id: "1", role: "user", content: [{ type: "text", text: "Read foo.ts" }], timestamp: 1 },
      {
        id: "2",
        role: "assistant",
        content: [
          { type: "text", text: "Reading..." },
          { type: "tool-call", toolCallId: "c1", toolName: "read_file", args: { path: "foo.ts" } },
        ],
        timestamp: 2,
      },
      { id: "3", role: "tool", content: [{ type: "tool-result", toolCallId: "c1", toolName: "read_file", result: "content" }], timestamp: 3 },
      { id: "4", role: "assistant", content: [{ type: "text", text: "Here it is." }], timestamp: 4 },
    ]
    const result = convertMessages(messages)
    expect(result).toHaveLength(4)
    expect(result[0]).toEqual({ role: "user", content: "Read foo.ts" })
    expect(result[3]).toEqual({ role: "assistant", content: [{ type: "text", text: "Here it is." }] })
  })
})

describe("convertTools", () => {
  it("converts a single tool", () => {
    const tools: ToolDefinition[] = [
      {
        name: "read_file",
        description: "Read a file",
        parameters: z.object({ path: z.string() }),
        execute: async () => "",
        dangerous: false,
      },
    ]
    const result = convertTools(tools)
    expect(result.read_file).toBeDefined()
    expect(Object.keys(result)).toEqual(["read_file"])
  })

  it("converts multiple tools", () => {
    const tools: ToolDefinition[] = [
      { name: "a", description: "Tool A", parameters: z.object({}), execute: async () => "", dangerous: false },
      { name: "b", description: "Tool B", parameters: z.object({ x: z.number() }), execute: async () => "", dangerous: false },
    ]
    const result = convertTools(tools)
    expect(Object.keys(result).sort()).toEqual(["a", "b"])
  })
})