/**
 * OpenCode Zen: one credential, two wire formats.
 *
 * Zen resells other Vendors' Models, so a single key reaches both the Anthropic
 * Messages dialect and the OpenAI Responses one. Which one a Turn uses is the
 * Model's own Protocol, read from the catalog — not a setting, and not
 * something the Provider can guess. The base URL is Zen's rather than any
 * Vendor's, which is the other half of what makes this route its own.
 */
import { describe, expect, it, beforeEach, afterEach } from "bun:test"
import { z } from "zod"
import { createProvider, UnsupportedModelError } from "@/providers"
import { listCatalogModels, setActiveCatalog } from "@/core/catalog"
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

const ZEN = "https://opencode.ai/zen/v1"
const CLAUDE = WIRE_MODEL.opencode // anthropic Protocol
const GPT = "gpt-5" // openai Protocol
const GEMINI = "gemini-3-pro" // a Protocol ViCode has no transport for

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

/** A Messages-format stream: enough for the adapter to consume without noise. */
const MESSAGES_STREAM = sse([
  {
    event: "message_start",
    data: {
      type: "message_start",
      message: {
        id: "msg_01",
        type: "message",
        role: "assistant",
        model: CLAUDE,
        content: [],
        stop_reason: null,
        stop_sequence: null,
        usage: { input_tokens: 100 },
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
  { event: "message_stop", data: { type: "message_stop" } },
])

/** A Responses-format stream: the same single answer, in the other dialect. */
const RESPONSES_STREAM = sse([
  {
    event: "response.output_item.added",
    data: {
      type: "response.output_item.added",
      output_index: 0,
      item: { id: "msg_01", type: "message", role: "assistant", status: "in_progress", content: [] },
    },
  },
  {
    event: "response.output_text.delta",
    data: {
      type: "response.output_text.delta",
      item_id: "msg_01",
      output_index: 0,
      content_index: 0,
      delta: "ok",
    },
  },
  {
    event: "response.output_item.done",
    data: {
      type: "response.output_item.done",
      output_index: 0,
      item: {
        id: "msg_01",
        type: "message",
        role: "assistant",
        status: "completed",
        content: [{ type: "output_text", text: "ok", annotations: [] }],
      },
    },
  },
  {
    event: "response.completed",
    data: {
      type: "response.completed",
      response: {
        id: "resp_01",
        object: "response",
        created_at: 0,
        model: GPT,
        status: "completed",
        output: [],
        parallel_tool_calls: false,
        tool_choice: "auto",
        tools: [],
        usage: { input_tokens: 100, output_tokens: 10, total_tokens: 110 },
      },
    },
  },
])

let originalFetch: typeof fetch
let api: ApiRecorder

beforeEach(() => {
  setActiveCatalog(TEST_CATALOG)
  originalFetch = globalThis.fetch
  api = recordApi(() => streamResponse(MESSAGES_STREAM))
})

afterEach(() => {
  restoreFetch(originalFetch)
  setActiveCatalog(null)
})

function zen(model: string) {
  // Compaction is optional on the Provider, but a shipped route must have it:
  // narrowing here says so once for the whole suite.
  const provider = createProvider({ model: `opencode/${model}`, apiKey: "oc-zen-secret" })
  if (!provider.summarize) throw new Error("the Zen route cannot summarize")
  return provider as Provider & Required<Pick<Provider, "summarize">>
}

describe("OpenCode Zen's transport choice", () => {
  it("sends a Claude Model over Anthropic Messages, at Zen's base URL", async () => {
    await collect(zen(CLAUDE).streamChat(HISTORY, TOOLS, "SYSTEM"))

    const request = api.only()
    expect(request.url).toBe(`${ZEN}/messages`)
    expect(request.headers.get("x-api-key")).toBe("oc-zen-secret")
    expect(request.body.input_schema).toBeUndefined()
    expect((request.body.tools as Record<string, unknown>[])[0]).toHaveProperty("input_schema")
  })

  it("sends a GPT Model over OpenAI Responses, at the same base URL", async () => {
    // The one thing that makes this a Gateway: a single credential reaching two
    // dialects, with the Model's own Protocol deciding which.
    api = recordApi(() => streamResponse(RESPONSES_STREAM))
    await collect(zen(GPT).streamChat(HISTORY, TOOLS, "SYSTEM"))

    const request = api.only()
    expect(request.url).toBe(`${ZEN}/responses`)
    expect(request.headers.get("authorization")).toBe("Bearer oc-zen-secret")
    expect((request.body.tools as Record<string, unknown>[])[0]).toHaveProperty("parameters")
  })

  it("refuses a Model whose Protocol ViCode has no transport for", () => {
    // Loudly, at construction: guessing a dialect would send the request to a
    // route that cannot read it.
    expect(() => zen(GEMINI)).toThrow(UnsupportedModelError)
    expect(() => zen(GEMINI)).toThrow(/does not record a wire protocol/)
  })

  it("refuses a Model it has no record of at all", () => {
    expect(() => zen("a-model-nobody-published")).toThrow(UnsupportedModelError)
  })
})

describe("OpenCode Zen's reach", () => {
  it("lists only the Models it can actually call", () => {
    const ids = listCatalogModels("opencode", TEST_CATALOG).map((m) => m.id)

    expect(ids).toContain(CLAUDE)
    expect(ids).toContain(GPT)
    // Offered by Zen, in the catalog, and uncallable from here.
    expect(ids).not.toContain(GEMINI)
  })

  it("reports each Model under the Zen prefix, not the Vendor's", () => {
    const provider = zen(CLAUDE)

    expect(provider.getModelInfo().id).toBe(`opencode/${CLAUDE}`)
    expect(provider.getModelInfo().provider).toBe("opencode")
  })

  it("prices a Model it resells from Zen's own rate card", async () => {
    // The same Model costs a different amount through each Provider, which is
    // why the catalog is looked up per Provider.
    const { usage } = finishOf(await collect(zen(CLAUDE).streamChat(HISTORY, TOOLS, "SYSTEM")))

    expect(usage.cost).toBeCloseTo(100 * (3 / 1_000_000), 10)
  })

  it("summarizes on whichever dialect the Model speaks", async () => {
    api = recordApi(() => streamResponse(RESPONSES_STREAM))
    const summary = await zen(GPT).summarize("TRANSCRIPT", "SUMMARIZE THIS")

    expect(summary.text).toBe("ok")
    expect(api.only().url).toBe(`${ZEN}/responses`)
  })
})