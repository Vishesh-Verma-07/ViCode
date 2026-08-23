import { describe, it, expect, beforeEach, afterEach } from "bun:test"
import { convertMessages, convertTools, createOpenRouterProvider, type ListModelsOptions } from "./openrouter"
import type { Message, ToolDefinition } from "../core/types"
import { z } from "zod"
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync, mkdirSync } from "fs"
import { join } from "path"
import { tmpdir } from "os"
import type { ModelListing } from "../core/provider"

function makeFetchOk(models: unknown[]): typeof fetch {
  return (async () =>
    new Response(JSON.stringify({ data: models }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    })) as unknown as typeof fetch
}

function makeFetchFailing(): typeof fetch {
  return (async () => {
    throw new Error("network unreachable")
  }) as unknown as typeof fetch
}

const OPENROUTER_MODELS = [
  {
    id: "deepseek/deepseek-r1:free",
    name: "DeepSeek: R1 (free)",
    pricing: { prompt: "0", completion: "0" },
  },
  {
    id: "anthropic/claude-sonnet-4",
    name: "Anthropic: Claude Sonnet 4",
    pricing: { prompt: "0.000003", completion: "0.000015" },
  },
]

describe("provider.listModels", () => {
  let tempDir: string
  let cachePath: string

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "vicode-models-test-"))
    cachePath = join(tempDir, "models-cache.json")
  })

  function cleanup(): void {
    rmSync(tempDir, { recursive: true, force: true })
  }

  function makeOpts(overrides?: Partial<ListModelsOptions>): ListModelsOptions {
    return { cachePath, ...overrides }
  }

  function provider(opts?: Partial<ListModelsOptions>) {
    return createOpenRouterProvider(
      { apiKey: "test-key", model: "anthropic/claude-sonnet-4" },
      makeOpts(opts),
    )
  }

  it("fetches models and distinguishes free from paid", async () => {
    let calls = 0
    const fetchImpl = (async (input: Parameters<typeof fetch>[0]) => {
      calls++
      expect(String(input)).toBe("https://openrouter.ai/api/v1/models")
      return new Response(JSON.stringify({ data: OPENROUTER_MODELS }), { status: 200 })
    }) as unknown as typeof fetch

    const result = await provider({ fetchImpl }).listModels()

    expect(calls).toBe(1)
    expect(result).toHaveLength(2)
    expect(result[0]).toEqual({
      id: "deepseek/deepseek-r1:free",
      name: "DeepSeek: R1 (free)",
      pricing: { kind: "free" },
    })
    expect(result[1]?.id).toBe("anthropic/claude-sonnet-4")
    expect(result[1]?.name).toBe("Anthropic: Claude Sonnet 4")
    expect(result[1]?.pricing).toEqual({
      kind: "paid",
      inputPricePerToken: 0.000003,
      outputPricePerToken: 0.000015,
    })
  })

  it("writes the cache on a successful fetch", async () => {
    try {
      await provider({ fetchImpl: makeFetchOk(OPENROUTER_MODELS) }).listModels()

      expect(existsSync(cachePath)).toBe(true)
      const cached = JSON.parse(readFileSync(cachePath, "utf-8")) as { models: ModelListing[] }
      expect(cached.models).toHaveLength(2)
      expect(cached.models[0]).toEqual({
        id: "deepseek/deepseek-r1:free",
        name: "DeepSeek: R1 (free)",
        pricing: { kind: "free" },
      })
    } finally {
      cleanup()
    }
  })

  it("falls back to the cache when the fetch fails", async () => {
    try {
      writeFileSync(
        cachePath,
        JSON.stringify({
          fetchedAt: "2026-01-01T00:00:00.000Z",
          models: [
            {
              id: "openai/gpt-4o",
              name: "OpenAI: GPT-4o",
              pricing: { kind: "paid", inputPricePerToken: 0.0000025, outputPricePerToken: 0.00001 },
            },
          ],
        }),
        "utf-8",
      )

      const result = await provider({ fetchImpl: makeFetchFailing() }).listModels()

      expect(result).toEqual([
        {
          id: "openai/gpt-4o",
          name: "OpenAI: GPT-4o",
          pricing: { kind: "paid", inputPricePerToken: 0.0000025, outputPricePerToken: 0.00001 },
        },
      ])
    } finally {
      cleanup()
    }
  })

  it("rejects with a clear error when the fetch fails and no cache exists", async () => {
    try {
      let result: ModelListing[] | undefined
      let error: unknown
      try {
        result = await provider({ fetchImpl: makeFetchFailing() }).listModels()
      } catch (e) {
        error = e
      }

      expect(result).toBeUndefined()
      expect(error).toBeInstanceOf(Error)
      expect((error as Error).message).toContain("no cached model list")
    } finally {
      cleanup()
    }
  })

  it("treats a non-200 response as failure and serves the cache", async () => {
    try {
      writeFileSync(
        cachePath,
        JSON.stringify({
          fetchedAt: "2026-01-01T00:00:00.000Z",
          models: [{ id: "m/1", name: "Model One", pricing: { kind: "free" } }],
        }),
        "utf-8",
      )

      const fetchImpl = (async () => new Response("rate limited", { status: 429 })) as unknown as typeof fetch
      const result = await provider({ fetchImpl }).listModels()

      expect(result).toEqual([{ id: "m/1", name: "Model One", pricing: { kind: "free" } }])
    } finally {
      cleanup()
    }
  })

  it("treats a malformed cache file as missing", async () => {
    try {
      mkdirSync(tempDir, { recursive: true })
      writeFileSync(cachePath, "{ not valid json", "utf-8")

      let error: unknown
      try {
        await provider({ fetchImpl: makeFetchFailing() }).listModels()
      } catch (e) {
        error = e
      }

      expect(error).toBeInstanceOf(Error)
      expect((error as Error).message).toContain("no cached model list")
    } finally {
      cleanup()
    }
  })

  afterEach(cleanup)
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
