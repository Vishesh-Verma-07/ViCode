import { describe, it, expect } from "bun:test"
import { convertMessages, convertTools } from "./openrouter"
import type { Message, ToolDefinition } from "../core/types"
import { z } from "zod"

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
