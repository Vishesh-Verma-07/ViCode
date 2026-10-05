/**
 * The Anthropic route, against the Messages wire format.
 *
 * Anthropic is where the vendor dialects part company, so this suite pins the
 * bytes: `x-api-key` rather than a bearer token, a top-level `system` field
 * rather than a message, `input_schema` rather than `parameters`, and a tool
 * result replayed inside a `user` message. It then pins the other direction —
 * what Anthropic's stream events become, and the fact that its prompt tokens
 * count the cached ones on top rather than inside.
 */
import { describe, expect, it, beforeEach, afterEach } from "bun:test"
import { z } from "zod"
import { createProvider } from "@/providers"
import { setActiveCatalog } from "@/core/catalog"
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

const MODEL = WIRE_MODEL.anthropic
const CANONICAL = `anthropic/${MODEL}`

/**
 * One turn of a real Anthropic stream: extended thinking, two text blocks, a
 * tool call whose arguments arrive in fragments, then the usage report.
 */
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
    data: { type: "content_block_start", index: 0, content_block: { type: "thinking", thinking: "" } },
  },
  {
    event: "content_block_delta",
    data: { type: "content_block_delta", index: 0, delta: { type: "thinking_delta", thinking: "weighing it" } },
  },
  { event: "content_block_stop", data: { type: "content_block_stop", index: 0 } },
  {
    event: "content_block_start",
    data: { type: "content_block_start", index: 1, content_block: { type: "text", text: "" } },
  },
  {
    event: "content_block_delta",
    data: { type: "content_block_delta", index: 1, delta: { type: "text_delta", text: "Reading" } },
  },
  {
    event: "content_block_delta",
    data: { type: "content_block_delta", index: 1, delta: { type: "text_delta", text: " it." } },
  },
  { event: "content_block_stop", data: { type: "content_block_stop", index: 1 } },
  {
    event: "content_block_start",
    data: {
      type: "content_block_start",
      index: 2,
      content_block: { type: "tool_use", id: "toolu_01", name: "read_file", input: {} },
    },
  },
  {
    event: "content_block_delta",
    data: { type: "content_block_delta", index: 2, delta: { type: "input_json_delta", partial_json: '{"path":' } },
  },
  {
    event: "content_block_delta",
    data: { type: "content_block_delta", index: 2, delta: { type: "input_json_delta", partial_json: '"a.ts"}' } },
  },
  { event: "content_block_stop", data: { type: "content_block_stop", index: 2 } },
  {
    event: "message_delta",
    data: {
      type: "message_delta",
      delta: { stop_reason: "tool_use", stop_sequence: null },
      usage: { output_tokens: 25 },
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
  {
    id: "2",
    role: "assistant",
    content: [
      { type: "text", text: "Reading." },
      { type: "tool-call", toolCallId: "toolu_00", toolName: "read_file", args: { path: "a.ts" } },
    ],
    timestamp: 2,
  },
  {
    id: "3",
    role: "tool",
    content: [
      { type: "tool-result", toolCallId: "toolu_00", toolName: "read_file", result: "file contents" },
    ],
    timestamp: 3,
  },
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

function anthropic() {
  // Compaction is optional on the Provider, but a shipped route must have it:
  // narrowing here says so once for the whole suite.
  const provider = createProvider({ model: CANONICAL, apiKey: "sk-anthropic-secret" })
  if (!provider.summarize) throw new Error("the Anthropic route cannot summarize")
  return provider as Provider & Required<Pick<Provider, "summarize">>
}

describe("the Anthropic request", () => {
  it("posts to Anthropic's own Messages endpoint", async () => {
    await collect(anthropic().streamChat(HISTORY, TOOLS, "SYSTEM"))

    expect(api.only().url).toBe("https://api.anthropic.com/v1/messages")
  })

  it("authenticates with x-api-key rather than a bearer token", async () => {
    await collect(anthropic().streamChat(HISTORY, TOOLS, "SYSTEM"))

    const { headers } = api.only()
    expect(headers.get("x-api-key")).toBe("sk-anthropic-secret")
    expect(headers.get("authorization")).toBeNull()
  })

  it("pins the API version Anthropic's Messages format is versioned by", async () => {
    await collect(anthropic().streamChat(HISTORY, TOOLS, "SYSTEM"))

    expect(api.only().headers.get("anthropic-version")).toBe("2023-06-01")
  })

  it("names the Model by its own id, with no Provider prefix", async () => {
    await collect(anthropic().streamChat(HISTORY, TOOLS, "SYSTEM"))

    expect(api.only().body.model).toBe(MODEL)
  })

  it("carries the system prompt in the top-level system field, not as a message", async () => {
    await collect(anthropic().streamChat(HISTORY, TOOLS, "TOP LEVEL SYSTEM"))

    const body = api.only().body
    expect(body.system).toEqual([{ type: "text", text: "TOP LEVEL SYSTEM" }])
    expect(body.messages).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ role: "system" })]),
    )
  })

  it("describes a tool with input_schema, the name Anthropic gives it", async () => {
    await collect(anthropic().streamChat(HISTORY, TOOLS, "SYSTEM"))

    const tools = api.only().body.tools as Record<string, unknown>[]
    expect(tools[0]!.name).toBe("read_file")
    expect(tools[0]!.input_schema).toMatchObject({ type: "object" })
    // The OpenAI spelling would be silently wrong here.
    expect(tools[0]).not.toHaveProperty("parameters")
  })

  it("replays a past tool call as tool_use content", async () => {
    await collect(anthropic().streamChat(HISTORY, TOOLS, "SYSTEM"))

    const messages = api.only().body.messages as Record<string, unknown>[]
    expect(messages[1]).toEqual({
      role: "assistant",
      content: [
        { type: "text", text: "Reading." },
        { type: "tool_use", id: "toolu_00", name: "read_file", input: { path: "a.ts" } },
      ],
    })
  })

  it("replays a tool result inside a user message, as tool_result", async () => {
    // Anthropic has no tool role: the result is user-role content keyed by the
    // call's id, which is why the two dialects are not interchangeable.
    await collect(anthropic().streamChat(HISTORY, TOOLS, "SYSTEM"))

    const messages = api.only().body.messages as Record<string, unknown>[]
    expect(messages[2]).toEqual({
      role: "user",
      content: [{ type: "tool_result", tool_use_id: "toolu_00", content: "file contents" }],
    })
  })

  it("sends the summary prompt as system and the transcript as the one message", async () => {
    await anthropic().summarize("A LONG TRANSCRIPT", "SUMMARIZE THIS")

    const body = api.only().body
    expect(body.system).toEqual([{ type: "text", text: "SUMMARIZE THIS" }])
    expect(body.messages).toEqual([
      { role: "user", content: [{ type: "text", text: "A LONG TRANSCRIPT" }] },
    ])
    expect(body.tools).toBeUndefined()
  })
})

describe("the Anthropic stream", () => {
  it("surfaces thinking as reasoning, apart from the answer", async () => {
    const events = await collect(anthropic().streamChat(HISTORY, TOOLS, "SYSTEM"))

    expect(events.filter((e) => e.type === "reasoning-delta")).toEqual([
      { type: "reasoning-delta", text: "weighing it" },
    ])
  })

  it("surfaces each text block delta in order", async () => {
    const events = await collect(anthropic().streamChat(HISTORY, TOOLS, "SYSTEM"))

    expect(events.filter((e) => e.type === "text-delta")).toEqual([
      { type: "text-delta", text: "Reading" },
      { type: "text-delta", text: " it." },
    ])
  })

  it("streams a tool call's arguments as they arrive, then once as parsed", async () => {
    // Anthropic sends arguments as JSON fragments, so the partial form is
    // available to render before the call is complete.
    const events = await collect(anthropic().streamChat(HISTORY, TOOLS, "SYSTEM"))

    expect(events.filter((e) => e.type === "tool-call-start")).toEqual([
      { type: "tool-call-start", toolCallId: "toolu_01", toolName: "read_file" },
    ])
    expect(events.filter((e) => e.type === "tool-call-delta")).toEqual([
      { type: "tool-call-delta", toolCallId: "toolu_01", argsDelta: '{"path":' },
      { type: "tool-call-delta", toolCallId: "toolu_01", argsDelta: '"a.ts"}' },
    ])
    expect(events.filter((e) => e.type === "tool-call-end")).toEqual([
      { type: "tool-call-end", toolCallId: "toolu_01", toolName: "read_file", args: { path: "a.ts" } },
    ])
  })

  it("counts the cached prompt tokens on top of the uncached ones", async () => {
    // Anthropic reports its cache separately and expects the caller to add it,
    // so 100 prompt + 40 read + 10 written is a 150-token prompt. OpenAI counts
    // them inside its own total — the two are not interchangeable.
    const { usage } = finishOf(await collect(anthropic().streamChat(HISTORY, TOOLS, "SYSTEM")))

    expect(usage).toMatchObject({
      inputTokens: 150,
      outputTokens: 25,
      totalTokens: 175,
      cacheReadTokens: 40,
      cacheWriteTokens: 10,
    })
  })

  it("prices the turn by what was cached and what was not", async () => {
    // 100 uncached at $5/M, 40 read at $0.50/M, 10 written at $6.25/M, 25 out
    // at $25/M.
    const { usage } = finishOf(await collect(anthropic().streamChat(HISTORY, TOOLS, "SYSTEM")))

    expect(usage.cost).toBeCloseTo(0.0012075, 10)
  })

  it("summarizes on the same wire as a real turn", async () => {
    const summary = await anthropic().summarize(STREAM, "SUMMARIZE THIS")

    expect(summary.text).toBe("Reading it.")
    expect(summary.usage.inputTokens).toBe(150)
    expect(summary.usage.cost).toBeCloseTo(0.0012075, 10)
  })

  it("reports a turn with nothing in it as no spend at all", async () => {
    api = recordApi(() =>
      streamResponse(
        sse([
          {
            event: "message_start",
            data: {
              type: "message_start",
              message: {
                id: "msg_02",
                type: "message",
                role: "assistant",
                model: MODEL,
                content: [],
                stop_reason: null,
                stop_sequence: null,
                usage: { input_tokens: 0 },
              },
            },
          },
          { event: "message_stop", data: { type: "message_stop" } },
        ]),
      ),
    )

    const { usage } = finishOf(await collect(anthropic().streamChat(HISTORY, TOOLS, "SYSTEM")))

    expect(usage).toMatchObject({ inputTokens: 0, outputTokens: 0, totalTokens: 0, cost: 0 })
  })
})

describe("the Anthropic Model", () => {
  it("reports itself as the canonical, provider-qualified id it serves", () => {
    expect(anthropic().getModelInfo()).toEqual({
      id: CANONICAL,
      name: MODEL,
      provider: "anthropic",
      contextLength: 200_000,
    })
  })

  it("names the window the catalog publishes, not a default", () => {
    const info = anthropic().getModelInfo()

    expect(info.contextLength).toBe(TEST_CATALOG.providers.anthropic[MODEL]!.contextLength)
  })

  it("stays callable when the catalog has no entry for it at all", async () => {
    // A Vendor's transport is fixed, so a Model missing from the catalog is
    // still reachable — it is only unknown, and priced at nothing.
    setActiveCatalog({ providers: { ...TEST_CATALOG.providers, anthropic: {} } })
    const events = await collect(anthropic().streamChat(HISTORY, TOOLS, "SYSTEM"))

    expect(finishOf(events).usage.cost).toBeNull()
  })
})