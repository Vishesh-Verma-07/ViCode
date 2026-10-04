import { describe, it, expect } from "bun:test"
import { contextShortfall, describeContextShortfall } from "@/core/context-shortfall"
import { CONTEXT_BUDGET_RATIO } from "@/core/constants"
import { estimateContextTokens } from "@/core/compaction"
import type { Message } from "@/core/types"

/** A user turn of `chars` characters, so a test can size a conversation exactly. */
function userTurn(chars: number): Message {
  return {
    id: `user_${chars}`,
    role: "user",
    content: [{ type: "text", text: "x".repeat(chars) }],
    timestamp: 0,
  }
}

describe("contextShortfall", () => {
  it("says nothing when the target Model's window is unknown", () => {
    expect(contextShortfall([userTurn(4_000_000)], null)).toBeNull()
  })

  it("says nothing when the conversation fits the target budget", () => {
    expect(contextShortfall([userTurn(1_000)], 200_000)).toBeNull()
  })

  it("says nothing when there is no conversation yet", () => {
    expect(contextShortfall([], 8_000)).toBeNull()
  })

  it("flags a conversation that will not fit the target budget", () => {
    const messages = [userTurn(200_000)]
    const shortfall = contextShortfall(messages, 32_000)

    expect(shortfall).not.toBeNull()
    expect(shortfall!.loadTokens).toBe(estimateContextTokens(messages))
    expect(shortfall!.budgetTokens).toBe(Math.floor(32_000 * CONTEXT_BUDGET_RATIO))
    expect(shortfall!.windowTokens).toBe(32_000)
  })

  it("measures against the budget the loop may fill, not the raw window", () => {
    // 25.0k of history sits under a 32k window but over its 22.4k budget, so a
    // check against the window would call a conversation that cannot be sent.
    expect(contextShortfall([userTurn(100_000)], 32_000)).not.toBeNull()

    // 20.0k fits the budget whatever it looks like against the window.
    expect(contextShortfall([userTurn(80_000)], 32_000)).toBeNull()
  })
})

describe("describeContextShortfall", () => {
  const shortfall = contextShortfall([userTurn(200_000)], 32_000)!

  it("puts the Context Load against the target budget and names the Model", () => {
    const line = describeContextShortfall("openrouter/tiny", shortfall)

    expect(line).toContain("50.0k")
    expect(line).toContain("32.0k")
    expect(line).toContain("22.4k")
    expect(line).toContain("openrouter/tiny")
    expect(line).toContain("156%")
  })

  it("admits history will be lost rather than describing the switch as harmless", () => {
    const line = describeContextShortfall("openrouter/tiny", shortfall)

    expect(line).toContain("compacted or truncated")
  })

  it("names no end of the history, because the two mechanisms drop opposite ones", () => {
    const line = describeContextShortfall("openrouter/tiny", shortfall)

    // Compaction folds the oldest; project() keeps the oldest prefix. Claiming
    // either end would be right about one path and wrong about the other.
    expect(line).not.toContain("oldest")
    expect(line).not.toContain("newest")
    expect(line).not.toContain("recent")
  })

  it("asks no question of its own, so a prompt and a refusal can each end it", () => {
    expect(describeContextShortfall("openrouter/tiny", shortfall)).not.toContain("?")
  })
})
