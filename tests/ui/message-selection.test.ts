import { describe, it, expect } from "bun:test"
import type { Message } from "@/core/types"
import {
  clampSelectionIndex,
  selectableMessages,
  selectionPayload,
} from "@/ui/message-selection"

function message(
  id: string,
  role: Message["role"],
  content: Message["content"],
): Message {
  return { id, role, content, timestamp: 0 }
}

describe("selectableMessages", () => {
  it("keeps user messages and assistant replies with text", () => {
    const selected = selectableMessages([
      message("u1", "user", [{ type: "text", text: "hello" }]),
      message("a1", "assistant", [{ type: "text", text: "hi there" }]),
      message("t1", "tool", [
        { type: "tool-result", toolCallId: "c1", toolName: "read_file", result: "file" },
      ]),
      message("s1", "system", [{ type: "text", text: "system prompt" }]),
    ])

    expect(selected.map((entry) => entry.id)).toEqual(["u1", "a1"])
    expect(selected[1]?.text).toBe("hi there")
  })

  it("drops messages whose text is only whitespace", () => {
    const selected = selectableMessages([
      message("u1", "user", [{ type: "text", text: " \n\t" }]),
      message("u2", "user", [{ type: "text", text: "real" }]),
    ])
    expect(selected.map((entry) => entry.id)).toEqual(["u2"])
  })

  it("leaves tool calls and attachments out of the copied text", () => {
    const selected = selectableMessages([
      message("a1", "assistant", [
        { type: "text", text: "checking" },
        { type: "tool-call", toolCallId: "c1", toolName: "read_file", args: { path: "a.ts" } },
      ]),
      message("u1", "user", [
        { type: "text", text: "look at this" },
        { type: "file-attachment", path: "a.ts", content: "secret contents" },
      ]),
    ])

    expect(selected.map((entry) => entry.text)).toEqual(["checking", "look at this"])
  })
})

describe("clampSelectionIndex", () => {
  it("keeps the index inside the transcript", () => {
    expect(clampSelectionIndex(-4, 3)).toBe(0)
    expect(clampSelectionIndex(9, 3)).toBe(2)
    expect(clampSelectionIndex(1, 3)).toBe(1)
  })

  it("stays at zero when there is nothing to select", () => {
    expect(clampSelectionIndex(4, 0)).toBe(0)
  })
})

describe("selectionPayload", () => {
  const messages = selectableMessages([
    message("u1", "user", [{ type: "text", text: "first question" }]),
    message("a1", "assistant", [{ type: "text", text: "first answer" }]),
    message("u2", "user", [{ type: "text", text: "second question" }]),
  ])

  it("copies the highlighted message when none are marked", () => {
    expect(selectionPayload(messages, new Set(), "a1")).toEqual({
      text: "first answer",
      count: 1,
    })
  })

  it("copies marked messages in transcript order", () => {
    expect(selectionPayload(messages, new Set(["u2", "u1"]), "a1")).toEqual({
      text: "first question\n\nsecond question",
      count: 2,
    })
  })

  it("finds nothing when the active message is gone and nothing is marked", () => {
    expect(selectionPayload(messages, new Set(), "missing")).toEqual({ text: "", count: 0 })
  })
})
