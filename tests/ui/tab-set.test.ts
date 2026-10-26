import { describe, it, expect } from "bun:test"
import {
  NEW_CHAT_TITLE,
  activeTab,
  createTabSet,
  firstUserMessage,
  focusTab,
  jumpToTab,
  nextTab,
  openTab,
  previousTab,
  setTabTitle,
  tabTitle,
} from "@/ui/tab-set"
import type { Message } from "@/core/types"

function textMessage(role: Message["role"], text: string): Message {
  return {
    id: `msg_${role}_${text}`,
    role,
    content: [{ type: "text", text }],
    timestamp: 0,
  }
}

describe("Tab set", () => {
  it("starts empty", () => {
    const set = createTabSet()
    expect(set.tabs).toEqual([])
    expect(set.activeId).toBeNull()
    expect(activeTab(set)).toBeNull()
  })

  it("opens a Tab at the end and focuses it", () => {
    const first = openTab(createTabSet())
    expect(first.tabs).toHaveLength(1)
    expect(activeTab(first)?.title).toBe(NEW_CHAT_TITLE)

    const second = openTab(first)
    expect(second.tabs.map((tab) => tab.id)).toEqual(["tab-1", "tab-2"])
    expect(second.activeId).toBe("tab-2")
  })

  it("opens a Tab under an id the caller already rendered", () => {
    const set = openTab(createTabSet(), { id: "tab-pre", title: "release prep" })
    expect(set.activeId).toBe("tab-pre")
    expect(set.tabs[0]).toEqual({ id: "tab-pre", title: "release prep" })
    expect(openTab(set).tabs.map((tab) => tab.id)).toEqual(["tab-pre", "tab-2"])
  })

  it("focuses an existing Tab and ignores an unknown one", () => {
    const set = openTab(openTab(createTabSet()))
    expect(focusTab(set, "tab-1").activeId).toBe("tab-1")

    const previous = focusTab(set, "tab-1")
    expect(focusTab(previous, "tab-1")).toBe(previous)
    expect(focusTab(previous, "nope")).toBe(previous)
  })

  it("moves to the next and previous Tab, wrapping at the ends", () => {
    const set = openTab(openTab(openTab(createTabSet())))
    expect(set.activeId).toBe("tab-3")

    expect(nextTab(set).activeId).toBe("tab-1")
    expect(previousTab(set).activeId).toBe("tab-2")
    expect(previousTab(previousTab(set)).activeId).toBe("tab-1")
  })

  it("does not move with fewer than two Tabs", () => {
    const set = openTab(createTabSet())
    expect(nextTab(set)).toBe(set)
    expect(previousTab(set)).toBe(set)
  })

  it("jumps to a position and leaves the set alone when the position does not exist", () => {
    const set = openTab(openTab(openTab(createTabSet())))

    expect(jumpToTab(set, 1).activeId).toBe("tab-1")
    expect(jumpToTab(set, 3).activeId).toBe("tab-3")
    expect(jumpToTab(set, 0)).toBe(set)
    expect(jumpToTab(set, 4)).toBe(set)
    expect(jumpToTab(set, 9)).toBe(set)
  })

  it("retitles a Tab once and returns the same set for a no-op", () => {
    const set = openTab(createTabSet())
    const retitled = setTabTitle(set, "tab-1", "release prep")

    expect(activeTab(retitled)?.title).toBe("release prep")
    expect(setTabTitle(retitled, "tab-1", "release prep")).toBe(retitled)
    expect(setTabTitle(retitled, "nope", "x")).toBe(retitled)
  })
})

describe("Tab title", () => {
  it("prefers the Session name", () => {
    expect(tabTitle({ name: "release prep", firstUserMessage: "fix the build" })).toBe("release prep")
  })

  it("falls back to the start of the first user message", () => {
    expect(tabTitle({ firstUserMessage: "how does the approval rule work?" })).toBe(
      "how does the approval rule work?",
    )
  })

  it("reads New chat when the Tab has neither", () => {
    expect(tabTitle({})).toBe(NEW_CHAT_TITLE)
    expect(tabTitle({ name: "   ", firstUserMessage: "   " })).toBe(NEW_CHAT_TITLE)
  })

  it("finds the first user message and skips assistant messages and empty text", () => {
    const messages: Message[] = [
      textMessage("assistant", "hello"),
      { id: "empty", role: "user", content: [], timestamp: 0 },
      textMessage("user", "  first   real\nmessage  "),
      textMessage("user", "second"),
    ]

    expect(firstUserMessage(messages)).toBe("first real message")
    expect(firstUserMessage([textMessage("assistant", "hi")])).toBeUndefined()
  })

  it("flattens inline code to its text so the strip has no backticks", () => {
    expect(firstUserMessage([textMessage("user", "try `bun run` on this")])).toBe("try bun run on this")
    expect(firstUserMessage([textMessage("user", "```\nconst x = 1\n```")])).toBe("const x = 1")
  })
})
