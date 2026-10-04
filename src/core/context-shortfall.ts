import type { Message } from "./types"
import { estimateContextTokens } from "./compaction"
import { contextBudgetFor } from "./project-context"
import { formatTokens } from "./cost-calculator"

/**
 * What a switch to a smaller window would cost the conversation: the tokens it
 * stands to lose, against the budget the target Model leaves the Agent Loop.
 */
export interface ContextShortfall {
  /** Estimated tokens in the conversation that would not fit. */
  loadTokens: number
  /** Tokens the target Model's window leaves the Agent Loop to send. */
  budgetTokens: number
  /** The target Model's whole context window. */
  windowTokens: number
}

/**
 * The shortfall a switch to `targetContextLength` would open, or null when
 * there is nothing to warn about.
 *
 * Null for an unknown window rather than a guess: warning about a limit nobody
 * has stated is the same confident lie as a 200k default. Null also when the
 * conversation fits the budget — the switch is then nothing but a switch, and
 * asking about it every time would train the answer to be `y`.
 */
export function contextShortfall(
  messages: Message[],
  targetContextLength: number | null,
): ContextShortfall | null {
  if (targetContextLength === null) return null
  const budget = contextBudgetFor(targetContextLength)
  if (budget === null) return null

  const load = estimateContextTokens(messages)
  if (load <= budget) return null

  return { loadTokens: load, budgetTokens: budget, windowTokens: targetContextLength }
}

/**
 * The shortfall in words: the Context Load the conversation already stands at,
 * the budget it would have to fit, and what happens to the rest.
 *
 * No question, so a confirmation prompt and a refusal can each close it in their
 * own words rather than one of them reading the other's sentence. No direction
 * either: Compaction folds the oldest history while Truncation keeps the oldest
 * prefix and drops what follows, so naming an end would be naming one of two
 * outcomes and calling it certain.
 */
export function describeContextShortfall(targetModelId: string, shortfall: ContextShortfall): string {
  const percent = Math.round((shortfall.loadTokens / shortfall.windowTokens) * 100)
  return (
    `This conversation is about ${formatTokens(shortfall.loadTokens)} tokens — ` +
    `${percent}% of the ${formatTokens(shortfall.windowTokens)} context window of ${targetModelId}, ` +
    `which leaves ${formatTokens(shortfall.budgetTokens)} to send. ` +
    `History will be compacted or truncated on the next turn.`
  )
}
