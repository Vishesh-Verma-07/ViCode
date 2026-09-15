import { describe, it, expect } from "bun:test"
import { project } from "./project-context"
import { VICODE_TRUNCATION_SENTINEL } from "./cap-result"
import type { Message } from "./types"

function byteLen(s: string): number {
  return new TextEncoder().encode(s).length
}

function msg(id: string, role: Message["role"], content: Message["content"]): Message {
  return { id, role, content, timestamp: 1 }
}

function textContent(text: string): Message["content"][number] {
  return { type: "text", text }
}

function toolResultContent(toolCallId: string, result: string): Message["content"][number] {
  return { type: "tool-result", toolCallId, toolName: "test", result }
}

function estimateTokens(s: string): number {
  return Math.ceil(byteLen(s) / 4)
}

describe("project", () => {
  it("returns all messages when budget is large enough", () => {
    const history = [
      msg("1", "user", [textContent("hello")]),
      msg("2", "assistant", [textContent("hi there")]),
    ]
    const result = project(history, 100_000)
    expect(result).toEqual(history)
  })

  it("returns empty for empty history", () => {
    expect(project([], 1000)).toEqual([])
  })

  it("returns empty when budget is 0", () => {
    const history = [msg("1", "user", [textContent("hello")])]
    expect(project(history, 0)).toEqual([])
  })

  it("trims only tool results, not conversation prose", () => {
    const bigResult = "x".repeat(40_000)
    const history = [
      msg("1", "user", [textContent("question")]),
      msg("2", "tool", [toolResultContent("tc1", bigResult)]),
      msg("3", "assistant", [textContent("answer")]),
    ]
    const result = project(history, 5000)

    const prose = result.find((m) => m.id === "1")
    expect(prose).toBeDefined()

    const toolMsg = result.find((m) => m.id === "2")
    expect(toolMsg).toBeDefined()
    const toolContent = toolMsg!.content.find((c) => c.type === "text" || c.type === "tool-result")
    expect(toolContent).toBeDefined()
    expect(toolContent!.type).toBe("text")
    expect((toolContent as { text: string }).text).toContain(VICODE_TRUNCATION_SENTINEL)
  })

  it("preserves newest turns when budget is tight", () => {
    const oldResult = "x".repeat(40_000)
    const history = [
      msg("1", "tool", [toolResultContent("tc1", oldResult)]),
      msg("2", "assistant", [textContent("thinking")]),
      msg("3", "user", [textContent("latest question")]),
    ]
    const result = project(history, 2000)

    const userMsg = result.find((m) => m.id === "3")
    expect(userMsg).toBeDefined()

    const assistantMsg = result.find((m) => m.id === "2")
    expect(assistantMsg).toBeDefined()
  })

  it("is deterministic - same input produces same output", () => {
    const history = [
      msg("1", "tool", [toolResultContent("tc1", "x".repeat(40_000))]),
      msg("2", "assistant", [textContent("ok")]),
    ]
    const r1 = project(history, 2000)
    const r2 = project(history, 2000)
    expect(r1).toEqual(r2)
  })

  it("applies custom budget", () => {
    const history = [
      msg("1", "tool", [toolResultContent("tc1", "x".repeat(40_000))]),
    ]
    const r1 = project(history, 2000)
    const r2 = project(history, 20_000)
    expect(r1.length).toBeLessThanOrEqual(r2.length)
  })

  it("never trims prose that fits, even when a huge result needs trimming", () => {
    const bigText = "x".repeat(40_000)
    const history = [
      msg("1", "user", [textContent("the question")]),
      msg("2", "tool", [toolResultContent("tc1", bigText)]),
    ]
    const result = project(history, 2000)

    const userMsg = result.find((m) => m.id === "1")
    expect(userMsg).toBeDefined()
    const text = (userMsg!.content[0] as { text: string }).text
    expect(text).toBe("the question")
  })

  it("adds truncation marker with omitted token count", () => {
    const bigResult = "x".repeat(40_000)
    const history = [
      msg("1", "tool", [toolResultContent("tc1", bigResult)]),
    ]
    const result = project(history, 2000)
    expect(result).toHaveLength(1)
    const textContent = result[0]!.content.find((c) => c.type === "text")
    expect(textContent).toBeDefined()
    const text = (textContent as { text: string }).text
    expect(text).toContain("tokens omitted by context-budget projection")
    expect(text).toContain(VICODE_TRUNCATION_SENTINEL)
  })

  it("returns entire history when nothing exceeds budget", () => {
    const history = [
      msg("1", "user", [textContent("hello")]),
      msg("2", "tool", [toolResultContent("tc1", "small result")]),
      msg("3", "assistant", [textContent("done")]),
    ]
    const result = project(history, 100_000)
    expect(result).toHaveLength(3)
    expect(result).toEqual(history)
  })

  it("trims oldest-and-largest tool results first", () => {
    const mediumResult = "y".repeat(20_000)
    const hugeResult = "x".repeat(40_000)
    const history = [
      msg("1", "tool", [toolResultContent("tc1", mediumResult)]),
      msg("2", "tool", [toolResultContent("tc2", hugeResult)]),
      msg("3", "assistant", [textContent("ok")]),
    ]
    const result = project(history, 3000)

    const msg1 = result.find((m) => m.id === "1")
    const msg2 = result.find((m) => m.id === "2")

    const msg1Trimmed = msg1?.content.some(
      (c) => c.type === "text" && (c as { text: string }).text.includes("tokens omitted"),
    )
    const msg2Trimmed = msg2?.content.some(
      (c) => c.type === "text" && (c as { text: string }).text.includes("tokens omitted"),
    )

    if (msg1Trimmed && msg2Trimmed) {
      const msg1Omitted = parseInt(
        (msg1!.content.find((c) => c.type === "text") as { text: string }).text.match(
          /(\d+) tokens omitted/,
        )?.[1] ?? "0",
      )
      const msg2Omitted = parseInt(
        (msg2!.content.find((c) => c.type === "text") as { text: string }).text.match(
          /(\d+) tokens omitted/,
        )?.[1] ?? "0",
      )
      expect(msg2Omitted).toBeGreaterThanOrEqual(msg1Omitted)
    }
  })

  it("never exceeds the budget", () => {
    const history = [
      msg("1", "tool", [toolResultContent("tc1", "x".repeat(40_000))]),
      msg("2", "tool", [toolResultContent("tc2", "y".repeat(40_000))]),
      msg("3", "assistant", [textContent("response")]),
    ]
    const budget = 5000
    const result = project(history, budget)

    let totalTokens = 0
    for (const m of result) {
      totalTokens += Math.ceil(byteLen(JSON.stringify(m)) / 4)
    }
    expect(totalTokens).toBeLessThanOrEqual(budget)
  })

  it("does not mutate original history", () => {
    const bigResult = "x".repeat(40_000)
    const history = [
      msg("1", "tool", [toolResultContent("tc1", bigResult)]),
    ]
    const original = JSON.stringify(history)
    project(history, 2000)
    expect(JSON.stringify(history)).toBe(original)
  })
})
