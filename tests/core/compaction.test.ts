import { describe, it, expect } from "bun:test"
import {
  compactHistory,
  compactableIndex,
  compactThresholdTokens,
  contextLengthOf,
  foldableMessages,
  isAtCompactThreshold,
  needsCompaction,
  serializeTranscript,
  canCompact,
  runningSummaryOf,
  type CompactionResult,
} from "@/core/compaction"
import type { Provider, StreamEvent } from "@/core/provider"
import type { Message, ContextSummaryContent } from "@/core/types"

function msg(role: Message["role"], text: string, id: string = role): Message {
  return {
    id,
    role,
    content: [{ type: "text", text }],
    timestamp: 0,
  }
}

function summaryMsg(summary: string, id = "summary_1"): Message {
  return {
    id,
    role: "user",
    content: [{ type: "context-summary", summary, foldedMessages: 1, foldedTokens: 1, at: 0 }],
    timestamp: 0,
  }
}

function createProvider(contextLength: number | null = 100_000, summarizeText = "New condensed state."): Provider {
  return {
    async *streamChat(): AsyncIterable<StreamEvent> {
      return
    },
    async summarize(transcript, prompt) {
      return { text: summarizeText, usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15, cost: 0.002 } }
    },
    getModelInfo() {
      return { id: "mock", name: "Mock", contextLength }
    },
    async listModels() {
      return []
    },
  }
}

function noCapProvider(contextLength: number | null = 100_000): Provider {
  return {
    async *streamChat(): AsyncIterable<StreamEvent> {
      return
    },
    getModelInfo() {
      return { id: "mock", name: "Mock", contextLength }
    },
    async listModels() {
      return []
    },
  }
}

describe("foldableMessages", () => {
  it("folds everything before the last user message", () => {
    const messages = [msg("user", "hi", "u1"), msg("assistant", "hello", "a1"), msg("user", "again", "u2"), msg("assistant", "ok", "a2")]
    expect(foldableMessages(messages)).toEqual([messages[0]!, messages[1]!])
    expect(compactableIndex(messages)).toBe(2)
  })

  it("returns empty when the whole array is one turn", () => {
    expect(foldableMessages([msg("user", "hi", "u1")])).toEqual([])
    expect(foldableMessages([])).toEqual([])
  })

  it("never folds the running summary message", () => {
    const messages = [summaryMsg("old"), msg("user", "task", "u1"), msg("assistant", "done", "a1")]
    expect(foldableMessages(messages)).toEqual([])
    expect(runningSummaryOf(messages)).toBe("old")
  })
})

describe("metric helpers", () => {
  it("flags needsCompaction only when above threshold and capable", () => {
    const tiny = createProvider(100)
    const big = [
      msg("user", "x".repeat(400), "u1"),
      msg("assistant", "y".repeat(400), "a1"),
      msg("user", "z".repeat(400), "u2"),
    ]
    expect(isAtCompactThreshold(big, tiny)).toBe(true)
    expect(needsCompaction(big, tiny)).toBe(true)
    expect(needsCompaction(big, noCapProvider(100))).toBe(false)
    expect(needsCompaction([msg("user", "x".repeat(400), "u1")], tiny)).toBe(false)
    // Above threshold but with nothing before the last user turn: nothing to fold.
    expect(needsCompaction([msg("user", "x".repeat(400), "u1"), msg("assistant", "y".repeat(400), "a1")], tiny)).toBe(false)
  })

  it("canCompact reflects provider support", () => {
    expect(canCompact(createProvider())).toBe(true)
    expect(canCompact(noCapProvider())).toBe(false)
  })

  it("reports a Provider that names no context window as unknown, not as a default", () => {
    expect(contextLengthOf(createProvider(1000))).toBe(1000)
    expect(contextLengthOf(createProvider(null))).toBeNull()
    expect(compactThresholdTokens(createProvider(null))).toBeNull()
  })

  it("never compacts against a guessed window, however long the history grows", () => {
    const unmeasured = createProvider(null)
    const enormous = [
      msg("user", "x".repeat(4_000_000), "u1"),
      msg("assistant", "y".repeat(4_000_000), "a1"),
      msg("user", "z".repeat(4_000_000), "u2"),
    ]
    expect(isAtCompactThreshold(enormous, unmeasured)).toBe(false)
    expect(needsCompaction(enormous, unmeasured)).toBe(false)
  })
})

describe("compactHistory", () => {
  it("folds prior turns and keeps the last turn verbatim", async () => {
    const messages = [
      msg("user", "refactor the parser", "u1"),
      msg("assistant", "started", "a1"),
      msg("user", "also fix the error handling", "u2"),
      msg("assistant", "done", "a2"),
    ]
    const result = await compactHistory(messages, createProvider())

    expect(result.foldedMessages).toBe(2)
    expect(result.messages).toHaveLength(3)
    expect(result.messages[0]!.content[0]!.type).toBe("context-summary")
    expect(result.messages.slice(1)).toEqual(messages.slice(2))
    expect(result.usage.totalTokens).toBe(15)
  })

  it("grows the running summary on repeated compaction", async () => {
    const first = await compactHistory(
      [msg("user", "setup", "u1"), msg("assistant", "ok", "a1"), msg("user", "next", "u2")],
      createProvider(100_000, "First block."),
    )
    expect(first.messages[0]!.content[0]!.type).toBe("context-summary")
    expect((first.messages[0]!.content[0] as ContextSummaryContent).summary).toBe("First block.")

    const grown = await compactHistory(
      [...first.messages, msg("assistant", "middle", "a3"), msg("user", "later", "u3")],
      createProvider(100_000, "Second block."),
    )
    const summary = grown.messages[0]!.content[0]! as ContextSummaryContent
    expect(summary.type).toBe("context-summary")
    expect(summary.summary).toBe("First block.\n\nSecond block.")
    expect(grown.foldedMessages).toBe(2)
    expect(grown.messages.slice(1)).toEqual([msg("user", "later", "u3")])
  })

  it("no-ops when there is nothing to fold", async () => {
    const oneTurn = [msg("user", "hi", "u1"), msg("assistant", "yo", "a1")]
    const result = await compactHistory(oneTurn, createProvider())
    expect(result.foldedMessages).toBe(0)
    expect(result.messages).toBe(oneTurn)
    expect(result.summary).toBe("")
  })

  it("throws for providers without summarize support", async () => {
    const messages = [msg("user", "a", "u1"), msg("assistant", "b", "a1"), msg("user", "c", "u2")]
    expect(compactHistory(messages, noCapProvider())).rejects.toThrow(/does not support/)
  })
})

describe("serializeTranscript", () => {
  it("serializes text, tool calls and tool results, skipping the running summary", () => {
    const messages: Message[] = [
      summaryMsg("old"),
      msg("user", "run tests", "u1"),
      {
        id: "a1",
        role: "assistant",
        content: [
          { type: "text", text: "running" },
          { type: "tool-call", toolCallId: "c1", toolName: "bash", args: { command: "bun test" } },
        ],
        timestamp: 0,
      },
      {
        id: "t1",
        role: "tool",
        content: [{ type: "tool-result", toolCallId: "c1", toolName: "bash", result: "603 pass" }],
        timestamp: 0,
      },
    ]
    const text = serializeTranscript(messages)
    expect(text).not.toContain("old")
    expect(text).toContain("User: run tests")
    expect(text).toContain('tool call: bash({"command":"bun test"})')
    expect(text).toContain("tool result (bash): 603 pass")
  })
})