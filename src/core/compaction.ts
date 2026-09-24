import type { Message, ContextSummaryContent } from "./types"
import type { Provider, TokenUsage } from "./provider"
import { estimateMessageTokens } from "./project-context"
import { COMPACT_THRESHOLD_RATIO, FALLBACK_CONTEXT_LENGTH } from "./constants"

export const COMPACT_SUMMARY_SYSTEM_PROMPT = `You are a session summariser for ViCode, an AI coding agent.

Summarise the enclosed conversation transcript so it can replace the original messages in the model's context window. The summary will be read back by the same coding agent, so it must preserve everything needed to continue the work.

Produce a concise Markdown brief with exactly these sections:

- Goals: what the user set out to do.
- Decisions: technical choices made and why; note anything explicitly ruled out.
- Files touched: each path verbatim, and what changed there.
- Changes made: concrete edits, commands run (verbatim command lines), and their outcomes.
- Open threads: unresolved questions, pending steps, and anything the user is waiting on.

Rules:
- Keep every file path and command line verbatim. Never paraphrase or invent paths or commands.
- Only report what is actually in the transcript. Never invent, guess, or add external knowledge.
- Preserve the most recent state of every tooling step so work can resume exactly where it stopped.
- Be dense: bullets, not prose. No preamble and no "here is the summary" boilerplate.
- If a section has nothing to report, write "None."`

export const CONTEXT_SUMMARY_MARKER = "[Context compacted: the earlier conversation has been folded into the summary below.]"

let idCounter = 0
function nextCompactionId(): string {
  return `summary_${Date.now()}_${++idCounter}`
}

export function emptyUsage(): TokenUsage {
  return { inputTokens: 0, outputTokens: 0, totalTokens: 0, cost: 0 }
}

export function contextLengthOf(provider: Provider): number {
  const length = provider.getModelInfo().contextLength
  return length && length > 0 ? length : FALLBACK_CONTEXT_LENGTH
}

export function compactThresholdTokens(provider: Provider): number {
  return Math.floor(contextLengthOf(provider) * COMPACT_THRESHOLD_RATIO)
}

export function estimateContextTokens(messages: Message[]): number {
  return messages.reduce((n, m) => n + estimateMessageTokens(m), 0)
}

export function isRunningSummaryMessage(msg: Message): boolean {
  return msg.content.some((c) => c.type === "context-summary")
}

export function runningSummaryOf(messages: Message[]): string {
  return messages
    .filter(isRunningSummaryMessage)
    .flatMap((m) => m.content)
    .filter((c): c is ContextSummaryContent => c.type === "context-summary")
    .map((c) => c.summary)
    .join("\n\n")
}

/** Index where the verbatim tail starts: the last `user` message. Returns -1 when nothing can be folded. */
export function compactableIndex(messages: Message[]): number {
  let lastUser = -1
  for (let i = 0; i < messages.length; i++) {
    if (messages[i]!.role === "user") lastUser = i
  }
  return lastUser
}

/** The non-summary messages that a compaction would fold: everything before the last `user` message, minus the Running Summary. */
export function foldableMessages(messages: Message[]): Message[] {
  const cut = compactableIndex(messages)
  if (cut <= 0) return []
  return messages.slice(0, cut).filter((m) => !isRunningSummaryMessage(m))
}

export function isAtCompactThreshold(messages: Message[], provider: Provider): boolean {
  return estimateContextTokens(messages) >= compactThresholdTokens(provider)
}

export function canCompact(provider: Provider): boolean {
  return typeof provider.summarize === "function"
}

export function needsCompaction(messages: Message[], provider: Provider): boolean {
  return (
    canCompact(provider) &&
    foldableMessages(messages).length > 0 &&
    isAtCompactThreshold(messages, provider)
  )
}

function roleLabel(role: Message["role"]): string {
  switch (role) {
    case "user":
      return "User"
    case "assistant":
      return "Agent"
    case "tool":
      return "Tool"
    default:
      return role
  }
}

export function serializeTranscript(messages: Message[]): string {
  const lines: string[] = []
  for (const msg of messages) {
    if (isRunningSummaryMessage(msg)) continue
    const label = roleLabel(msg.role)
    for (const part of msg.content) {
      if (part.type === "text") lines.push(`${label}: ${part.text.trim()}`)
      else if (part.type === "tool-call") lines.push(`${label} tool call: ${part.toolName}(${JSON.stringify(part.args)})`)
      else if (part.type === "tool-result") lines.push(`${label} tool result (${part.toolName}): ${part.result.trim()}`)
    }
    lines.push("")
  }
  return lines.join("\n").trim()
}

export interface CompactionResult {
  messages: Message[]
  summary: string
  folded: Message[]
  foldedMessages: number
  foldedTokens: number
  usage: TokenUsage
}

/**
 * Fold every message before the last `user` message into the Running Summary,
 * keeping that turn and its Tool Results verbatim as the tail.
 */
export async function compactHistory(
  messages: Message[],
  provider: Provider,
  abortSignal?: AbortSignal,
): Promise<CompactionResult> {
  const folded = foldableMessages(messages)
  if (folded.length === 0) {
    return { messages, summary: "", folded: [], foldedMessages: 0, foldedTokens: 0, usage: emptyUsage() }
  }
  if (!provider.summarize) {
    throw new Error("Provider does not support context compaction.")
  }

  const cut = compactableIndex(messages)
  const tail = messages.slice(cut)
  const existingSummary = runningSummaryOf(messages.slice(0, cut))

  const transcript = serializeTranscript(folded)
  const { text, usage } = await provider.summarize(transcript, COMPACT_SUMMARY_SYSTEM_PROMPT, abortSignal)

  const summaryText = existingSummary ? existingSummary + "\n\n" + text.trim() : text.trim()
  const foldedTokens = estimateContextTokens(folded)

  const summaryMsg: Message = {
    id: nextCompactionId(),
    role: "user",
    content: [
      {
        type: "context-summary",
        summary: summaryText,
        foldedMessages: folded.length,
        foldedTokens,
        at: Date.now(),
      },
    ],
    timestamp: Date.now(),
  }

  return {
    messages: [summaryMsg, ...tail],
    summary: summaryText,
    folded,
    foldedMessages: folded.length,
    foldedTokens,
    usage,
  }
}

export function composeSummaryMessageText(c: ContextSummaryContent): string {
  return `${CONTEXT_SUMMARY_MARKER}\n${c.summary}`
}