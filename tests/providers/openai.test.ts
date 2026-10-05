/**
 * The OpenAI route, against the Responses wire format.
 *
 * Responses is the dialect that differs from Anthropic's in every direction:
 * a bearer token rather than `x-api-key`, the system prompt as a `developer`
 * entry inside `input` rather than a top-level field, tool arguments as a JSON
 * string on a top-level item rather than typed assistant content, and cached
 * prompt tokens counted *inside* its own total rather than added on top. Those
 * differences are the reason this route has its own file.
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

const MODEL = WIRE_MODEL.openai
const CANONICAL = `openai/${MODEL}`

/** One turn of a real Responses stream: a reasoning summary, an answer, a tool call. */
const STREAM = sse([
  {
    event: "response.created",
    data: {
      type: "response.created",
      response: {
        id: "resp_01",
        object: "response",
        created_at: 0,
        model: MODEL,
        status: "in_progress",
        output: [],
        parallel_tool_calls: false,
        tool_choice: "auto",
        tools: [],
        usage: null,
      },
    },
  },
  {
    event: "response.output_item.added",
    data: {
      type: "response.output_item.added",
      output_index: 0,
      item: { id: "rs_01", type: "reasoning", status: "in_progress", summary: [] },
    },
  },
  {
    event: "response.reasoning_summary_text.delta",
    data: {
      type: "response.reasoning_summary_text.delta",
      item_id: "rs_01",
      output_index: 0,
      summary_index: 0,
      delta: "weighing it",
    },
  },
  {
    event: "response.output_item.done",
    data: {
      type: "response.output_item.done",
      output_index: 0,
      item: {
        id: "rs_01",
        type: "reasoning",
        status: "completed",
        summary: [{ type: "summary_text", text: "weighing it" }],
      },
    },
  },
  {
    event: "response.output_item.added",
    data: {
      type: "response.output_item.added",
      output_index: 1,
      item: { id: "msg_01", type: "message", role: "assistant", status: "in_progress", content: [] },
    },
  },
  {
    event: "response.output_text.delta",
    data: {
      type: "response.output_text.delta",
      item_id: "msg_01",
      output_index: 1,
      content_index: 0,
      delta: "Reading",
    },
  },
  {
    event: "response.output_text.delta",
    data: {
      type: "response.output_text.delta",
      item_id: "msg_01",
      output_index: 1,
      content_index: 0,
      delta: " it.",
    },
  },
  {
    event: "response.output_item.done",
    data: {
      type: "response.output_item.done",
      output_index: 1,
      item: {
        id: "msg_01",
        type: "message",
        role: "assistant",
        status: "completed",
        content: [{ type: "output_text", text: "Reading it.", annotations: [] }],
      },
    },
  },
  {
    event: "response.output_item.added",
    data: {
      type: "response.output_item.added",
      output_index: 2,
      item: {
        id: "fc_01",
        type: "function_call",
        status: "in_progress",
        arguments: "",
        call_id: "call_01",
        name: "read_file",
      },
    },
  },
  {
    event: "response.function_call_arguments.delta",
    data: {
      type: "response.function_call_arguments.delta",
      item_id: "fc_01",
      output_index: 2,
      delta: '{"path":',
    },
  },
  {
    event: "response.function_call_arguments.delta",
    data: {
      type: "response.function_call_arguments.delta",
      item_id: "fc_01",
      output_index: 2,
      delta: '"a.ts"}',
    },
  },
  {
    event: "response.output_item.done",
    data: {
      type: "response.output_item.done",
      output_index: 2,
      item: {
        id: "fc_01",
        type: "function_call",
        status: "completed",
        arguments: '{"path":"a.ts"}',
        call_id: "call_01",
        name: "read_file",
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
        model: MODEL,
        status: "completed",
        output: [],
        parallel_tool_calls: false,
        tool_choice: "auto",
        tools: [],
        usage: {
          input_tokens: 100,
          input_tokens_details: { cached_tokens: 40 },
          output_tokens: 25,
          output_tokens_details: { reasoning_tokens: 8 },
          total_tokens: 125,
        },
      },
    },
  },
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
      { type: "tool-call", toolCallId: "call_00", toolName: "read_file", args: { path: "a.ts" } },
    ],
    timestamp: 2,
  },
  {
    id: "3",
    role: "tool",
    content: [
      { type: "tool-result", toolCallId: "call_00", toolName: "read_file", result: "file contents" },
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

function openai() {
  // Compaction is optional on the Provider, but a shipped route must have it:
  // narrowing here says so once for the whole suite.
  const provider = createProvider({ model: CANONICAL, apiKey: "sk-openai-secret" })
  if (!provider.summarize) throw new Error("the OpenAI route cannot summarize")
  return provider as Provider & Required<Pick<Provider, "summarize">>
}

describe("the OpenAI request", () => {
  it("posts to OpenAI's own Responses endpoint", async () => {
    await collect(openai().streamChat(HISTORY, TOOLS, "SYSTEM"))

    expect(api.only().url).toBe("https://api.openai.com/v1/responses")
  })

  it("authenticates with a bearer token rather than x-api-key", async () => {
    await collect(openai().streamChat(HISTORY, TOOLS, "SYSTEM"))

    const { headers } = api.only()
    expect(headers.get("authorization")).toBe("Bearer sk-openai-secret")
    expect(headers.get("x-api-key")).toBeNull()
  })

  it("names the Model by its own id, with no Provider prefix", async () => {
    await collect(openai().streamChat(HISTORY, TOOLS, "SYSTEM"))

    expect(api.only().body.model).toBe(MODEL)
  })

  it("carries the system prompt as the leading developer entry in input", async () => {
    await collect(openai().streamChat(HISTORY, TOOLS, "TOP LEVEL SYSTEM"))

    const body = api.only().body
    expect(body.input).toEqual(
      expect.arrayContaining([
        { role: "developer", content: "TOP LEVEL SYSTEM" },
      ]),
    ) as unknown
    // Anthropic's top-level `system` field is not part of this format.
    expect(body).not.toHaveProperty("system")
    expect(body).not.toHaveProperty("instructions")
  })

  it("describes a tool as a function with parameters, the name Responses gives it", async () => {
    await collect(openai().streamChat(HISTORY, TOOLS, "SYSTEM"))

    const tools = api.only().body.tools as Record<string, unknown>[]
    expect(tools[0]).toMatchObject({ type: "function", name: "read_file", description: "Read a file" })
    expect(tools[0]!.parameters).toMatchObject({ type: "object" })
    // The Anthropic spelling would be silently wrong here.
    expect(tools[0]).not.toHaveProperty("input_schema")
  })

  it("replays a past tool call as a top-level function_call item", async () => {
    await collect(openai().streamChat(HISTORY, TOOLS, "SYSTEM"))

    const input = api.only().body.input as Record<string, unknown>[]
    expect(input).toEqual(
      expect.arrayContaining([
        { type: "function_call", call_id: "call_00", name: "read_file", arguments: '{"path":"a.ts"}' },
      ]),
    )
  })

  it("replays a tool result as a top-level function_call_output item", async () => {
    // Responses has no tool role either, and the arguments arrive as a JSON
    // string rather than a parsed object.
    await collect(openai().streamChat(HISTORY, TOOLS, "SYSTEM"))

    const input = api.only().body.input as Record<string, unknown>[]
    expect(input).toEqual(
      expect.arrayContaining([
        { type: "function_call_output", call_id: "call_00", output: "file contents" },
      ]),
    )
    expect(input).not.toEqual(expect.arrayContaining([expect.objectContaining({ role: "tool" })]))
  })

  it("sends the summary prompt as the developer entry and the transcript as the one message", async () => {
    await openai().summarize("A LONG TRANSCRIPT", "SUMMARIZE THIS")

    const body = api.only().body
    expect(body.input).toEqual([
      { role: "developer", content: "SUMMARIZE THIS" },
      { role: "user", content: [{ type: "input_text", text: "A LONG TRANSCRIPT" }] },
    ]) as unknown
    expect(body.tools).toBeUndefined()
  })
})

describe("the OpenAI stream", () => {
  it("surfaces a reasoning summary as reasoning, apart from the answer", async () => {
    const events = await collect(openai().streamChat(HISTORY, TOOLS, "SYSTEM"))

    expect(events.filter((e) => e.type === "reasoning-delta")).toEqual([
      { type: "reasoning-delta", text: "weighing it" },
    ])
  })

  it("surfaces each text delta in order", async () => {
    const events = await collect(openai().streamChat(HISTORY, TOOLS, "SYSTEM"))

    expect(events.filter((e) => e.type === "text-delta")).toEqual([
      { type: "text-delta", text: "Reading" },
      { type: "text-delta", text: " it." },
    ])
  })

  it("carries a tool call through, keyed by the call id Responses uses", async () => {
    const events = await collect(openai().streamChat(HISTORY, TOOLS, "SYSTEM"))

    expect(events.filter((e) => e.type === "tool-call-start")).toEqual([
      { type: "tool-call-start", toolCallId: "call_01", toolName: "read_file" },
    ])
    expect(events.filter((e) => e.type === "tool-call-delta")).toEqual([
      { type: "tool-call-delta", toolCallId: "call_01", argsDelta: '{"path":' },
      { type: "tool-call-delta", toolCallId: "call_01", argsDelta: '"a.ts"}' },
    ])
    expect(events.filter((e) => e.type === "tool-call-end")).toEqual([
      { type: "tool-call-end", toolCallId: "call_01", toolName: "read_file", args: { path: "a.ts" } },
    ])
  })

  it("counts the cached prompt tokens inside its own total", async () => {
    // The opposite convention to Anthropic's: 40 of OpenAI's 100 prompt tokens
    // were served from cache, and are not 140.
    const { usage } = finishOf(await collect(openai().streamChat(HISTORY, TOOLS, "SYSTEM")))

    expect(usage).toMatchObject({
      inputTokens: 100,
      outputTokens: 25,
      totalTokens: 125,
      cacheReadTokens: 40,
    })
  })

  it("reports reasoning tokens as a breakdown of the output, not extra", async () => {
    const { usage } = finishOf(await collect(openai().streamChat(HISTORY, TOOLS, "SYSTEM")))

    expect(usage.reasoningTokens).toBe(8)
    expect(usage.outputTokens).toBe(25)
  })

  it("prices the cached tokens at the cached rate, falling back to the input rate", async () => {
    // 60 uncached at $1.25/M, 40 read at $1.25/M (the catalog publishes no cache
    // rate for this Model), 25 out at $10/M.
    const { usage } = finishOf(await collect(openai().streamChat(HISTORY, TOOLS, "SYSTEM")))

    expect(usage.cost).toBeCloseTo(0.000375, 10)
  })

  it("summarizes on the same wire as a real turn", async () => {
    const summary = await openai().summarize(STREAM, "SUMMARIZE THIS")

    expect(summary.text).toBe("Reading it.")
    expect(summary.usage.inputTokens).toBe(100)
    expect(summary.usage.cost).toBeCloseTo(0.000375, 10)
  })
})

describe("the OpenAI Model", () => {
  it("reports itself as the canonical, provider-qualified id it serves", () => {
    expect(openai().getModelInfo()).toEqual({
      id: CANONICAL,
      name: MODEL,
      provider: "openai",
      contextLength: 400_000,
    })
  })

  it("names the window the catalog publishes, not a default", () => {
    const info = openai().getModelInfo()

    expect(info.contextLength).toBe(TEST_CATALOG.providers.openai[MODEL]!.contextLength)
  })
})