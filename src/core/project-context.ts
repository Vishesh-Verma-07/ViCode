import type { Message } from "./types"
import type { Provider } from "./provider"
import { VICODE_TRUNCATION_SENTINEL } from "./cap-result"
import { CONTEXT_BUDGET_RATIO, FALLBACK_CONTEXT_LENGTH } from "./constants"

const BYTE_PER_TOKEN = 4
const MESSAGE_OVERHEAD_TOKENS = 4
const MARKER_OVERHEAD_TOKENS = 20

function byteLen(s: string): number {
  return new TextEncoder().encode(s).length
}

export function estimateMessageTokens(msg: Message): number {
  let tokens = MESSAGE_OVERHEAD_TOKENS
  for (const part of msg.content) {
    if (part.type === "text") tokens += Math.ceil(byteLen(part.text) / BYTE_PER_TOKEN)
    else if (part.type === "tool-result") tokens += Math.ceil(byteLen(part.result) / BYTE_PER_TOKEN)
    else if (part.type === "tool-call") tokens += Math.ceil(byteLen(JSON.stringify(part.args)) / BYTE_PER_TOKEN)
    else if (part.type === "context-summary") tokens += Math.ceil(byteLen(part.summary) / BYTE_PER_TOKEN)
  }
  return tokens
}

function truncationMarker(omittedTokens: number): string {
  const s = VICODE_TRUNCATION_SENTINEL
  return (
    "\n\n" + s + "\n" + omittedTokens + " tokens omitted by context-budget projection.\n" +
    "Re-query narrowly (bounded read range, narrower search, targeted command) before relying on exact text.\n" +
    s + "\n"
  )
}

export function contextBudget(provider: Provider): number {
  const contextLength = provider.getModelInfo().contextLength
  const base = contextLength && contextLength > 0 ? contextLength : FALLBACK_CONTEXT_LENGTH
  return Math.floor(base * CONTEXT_BUDGET_RATIO)
}

export function project(history: Message[], budget: number): Message[] {
  if (budget <= 0 || history.length === 0) return []

  const projected: Message[] = []
  let used = 0

  for (const msg of history) {
    const tokens = estimateMessageTokens(msg)

    if (used + tokens <= budget) {
      projected.push(msg)
      used += tokens
      continue
    }

    if (msg.role !== "tool") break

    const candidates = msg.content
      .map((part, i) => ({ part, i }))
      .filter((x) => x.part.type === "tool-result")
      .sort((a, b) => a.i - b.i || byteLen((b.part as { result: string }).result) - byteLen((a.part as { result: string }).result))

    if (candidates.length === 0) break

    const markerTokenCost = MARKER_OVERHEAD_TOKENS
    const budgetForContent = budget - used - markerTokenCost
    if (budgetForContent <= 0) break

    let totalOmittedTokens = 0
    const trimmedIndices = new Set<number>()
    let currentTokens = tokens

    for (const { part, i } of candidates) {
      if (currentTokens <= budgetForContent) break
      const resultTokens = Math.ceil(byteLen((part as { result: string }).result) / BYTE_PER_TOKEN)
      trimmedIndices.add(i)
      currentTokens -= resultTokens
      totalOmittedTokens += resultTokens
    }

    const newContent = msg.content
      .filter((_, i) => !trimmedIndices.has(i))
      .concat([{ type: "text" as const, text: truncationMarker(totalOmittedTokens) }])

    const newTokens = currentTokens + markerTokenCost
    if (used + newTokens <= budget) {
      projected.push({ ...msg, content: newContent })
      used += newTokens
      continue
    }

    break
  }

  return projected
}
