import type { Message } from "../core/types"

/** One message the user can put on the clipboard. */
export interface SelectableMessage {
  id: string
  role: "user" | "assistant"
  text: string
}

/** The words a Message carries, without tool calls, results or attachments. */
export function messageText(message: Message): string {
  return message.content
    .filter((content) => content.type === "text")
    .map((content) => (content.type === "text" ? content.text : ""))
    .join("")
}

/**
 * The turns worth copying: a user message or an assistant reply that has text.
 * Tool results and compaction summaries are machinery rather than something the
 * user wrote or the model said, so they never enter Select Mode.
 */
export function selectableMessages(messages: Message[]): SelectableMessage[] {
  const selectable: SelectableMessage[] = []
  for (const message of messages) {
    if (message.role !== "user" && message.role !== "assistant") continue
    const text = messageText(message)
    if (!text.trim()) continue
    selectable.push({ id: message.id, role: message.role, text })
  }
  return selectable
}

export function clampSelectionIndex(index: number, count: number): number {
  if (count <= 0) return 0
  return Math.max(0, Math.min(index, count - 1))
}

/**
 * The text Enter should copy. Marked messages win when there are any, kept in
 * transcript order rather than the order they were marked; with none marked,
 * the highlighted message is the selection.
 */
export function selectionPayload(
  messages: SelectableMessage[],
  markedIds: ReadonlySet<string>,
  activeId: string | undefined,
): { text: string; count: number } {
  const chosen =
    markedIds.size > 0
      ? messages.filter((message) => markedIds.has(message.id))
      : messages.filter((message) => message.id === activeId)
  return {
    text: chosen.map((message) => message.text).join("\n\n"),
    count: chosen.length,
  }
}
