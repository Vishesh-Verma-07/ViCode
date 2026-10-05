/**
 * OpenCode Go: the same console as Zen, on a different bill.
 *
 * Go shares Zen's key and its Anthropic-compatible surface but sits at its own
 * base URL and is paid for by subscription rather than per token. That second
 * fact is the one with teeth: a Model the catalog prices must still report an
 * unknown cost here, because attributing a per-token charge to a plan the user
 * has already paid for invents a number.
 */
import { describe, expect, it, beforeEach, afterEach } from "bun:test"
import { z } from "zod"
import { createProvider } from "@/providers"
import { setActiveCatalog } from "@/core/catalog"
import { isPerTokenProvider } from "@/core/providers"
import type { Message, ToolDefinition } from "@/core/types"
import type { Provider } from "@/core/provider"
import {
  TEST_CATALOG,
  WIRE_MODEL,
  collect,
  finishOf,
  recordApi,
  restoreFetch,
  sse,
  streamResponse,
  type ApiRecorder,
} from "./harness"

const GO = "https://opencode.ai/zen/go/v1"
const MODEL = WIRE_MODEL["opencode-go"]
const CANONICAL = `opencode-go/${MODEL}`

const STREAM = sse([
  {
    event: "message_start",
    data: {
      type: "message_start",
      message: {
        id: "msg_01",
        type: "message",
        role: "assistant",
        model: MODEL,
        content: [],
        stop_reason: null,
        stop_sequence: null,
        usage: { input_tokens: 100, cache_read_input_tokens: 40, cache_creation_input_tokens: 10 },
      },
    },
  },
  {
    event: "content_block_start",
    data: { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
  },
  {
    event: "content_block_delta",
    data: { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "ok" } },
  },
  { event: "content_block_stop", data: { type: "content_block_stop", index: 0 } },
  {
    event: "message_delta",
    data: {
      type: "message_delta",
      delta: { stop_reason: "end_turn", stop_sequence: null },
      usage: { output_tokens: 12 },
    },
  },
  { event: "message_stop", data: { type: "message_stop" } },
])

const TOOLS: ToolDefinition[] = [
  {
    name: "read_file",
    description: "Read a file",
    parameters: z.object({ path: z.string() }),
    execute: async () => "",
    dangerous: false,
  },
]

const HISTORY: Message[] = [
  { id: "1", role: "user", content: [{ type: "text", text: "Read a.ts" }], timestamp: 1 },
]

let originalFetch: typeof fetch
let api: ApiRecorder

beforeEach(() => {
  setActiveCatalog(TEST_CATALOG)
  originalFetch = globalThis.fetch
  api = recordApi(() => streamResponse(STREAM))
})

afterEach(() => {
  restoreFetch(originalFetch)
  setActiveCatalog(null)
})

function go() {
  // Compaction is optional on the Provider, but a shipped route must have it:
  // narrowing here says so once for the whole suite.
  const provider = createProvider({ model: CANONICAL, apiKey: "oc-go-secret" })
  if (!provider.summarize) throw new Error("the Go route cannot summarize")
  return provider as Provider & Required<Pick<Provider, "summarize">>
}

describe("the OpenCode Go route", () => {
  it("posts to Go's own base URL, not Zen's", async () => {
    await collect(go().streamChat(HISTORY, TOOLS, "SYSTEM"))

    expect(api.only().url).toBe(`${GO}/messages`)
    expect(api.only().url).not.toContain("/zen/v1/")
  })

  it("authenticates with the console's one key, as x-api-key", async () => {
    // One console, one key, two routes: Zen and Go take the same credential.
    await collect(go().streamChat(HISTORY, TOOLS, "SYSTEM"))

    expect(api.only().headers.get("x-api-key")).toBe("oc-go-secret")
  })

  it("speaks the Anthropic dialect, like every other Go Model", async () => {
    await collect(go().streamChat(HISTORY, TOOLS, "SYSTEM"))

    const request = api.only()
    expect(request.body.system).toEqual([{ type: "text", text: "SYSTEM" }])
    expect((request.body.tools as Record<string, unknown>[])[0]).toHaveProperty("input_schema")
  })

  it("reports the Model under the Go prefix", () => {
    expect(go().getModelInfo()).toEqual({
      id: CANONICAL,
      name: MODEL,
      provider: "opencode-go",
      contextLength: 256_000,
    })
  })

  it("counts tokens as any other route does", async () => {
    const { usage } = finishOf(await collect(go().streamChat(HISTORY, TOOLS, "SYSTEM")))

    expect(usage).toMatchObject({
      inputTokens: 150,
      outputTokens: 12,
      totalTokens: 162,
      cacheReadTokens: 40,
      cacheWriteTokens: 10,
    })
  })

  it("reports a Turn's cost as unknown, however the catalog prices the Model", async () => {
    // The catalog does price grok-code, at $1/M in and $2/M out. On a
    // subscription that figure buys nothing: the plan is already paid for, so
    // a dollar amount here would be a charge the user never made.
    const { usage } = finishOf(await collect(go().streamChat(HISTORY, TOOLS, "SYSTEM")))

    expect(TEST_CATALOG.providers["opencode-go"][MODEL]!.pricing).not.toBeNull()
    expect(usage.cost).toBeNull()
  })

  it("leaves a summary's cost unknown for the same reason", async () => {
    const summary = await go().summarize("TRANSCRIPT", "SUMMARIZE THIS")

    expect(summary.text).toBe("ok")
    expect(summary.usage.cost).toBeNull()
  })

  it("is the only route billed by subscription", () => {
    const subscription = ["opencode-go"]

    for (const id of ["openrouter", "openai", "anthropic", "opencode", "opencode-go"] as const) {
      expect(isPerTokenProvider(id)).toBe(!subscription.includes(id))
    }
  })
})