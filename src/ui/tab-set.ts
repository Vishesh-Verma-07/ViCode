import type { Message } from "../core/types"
import { tokenizeCodeText } from "../core/code-tokenizer"

/** The title of a Tab that has neither a Session name nor a message yet. */
export const NEW_CHAT_TITLE = "New chat"

export interface Tab {
  id: string
  title: string
}

export interface TabSet {
  /** In Tab Bar order. */
  tabs: Tab[]
  /** The Tab the window is showing, or null when none is open. */
  activeId: string | null
  /** The number the next generated id uses, kept here so opening stays pure. */
  nextNumber: number
}

export interface OpenTabOptions {
  /** A stable id for a Tab the caller already renders; generated when absent. */
  id?: string
  /** The title to open with; a Tab with no message yet reads New chat. */
  title?: string
}

/**
 * The Tab set: the ordered list of open Tabs and the active one. It knows
 * nothing about React, terminals or streaming, so every rule below is provable
 * with plain values.
 */
export function createTabSet(): TabSet {
  return { tabs: [], activeId: null, nextNumber: 1 }
}

/** Appends a Tab and focuses it, because opening one is also going to it. */
export function openTab(state: TabSet, options: OpenTabOptions = {}): TabSet {
  // Adopting an id that is already open focuses that Tab instead of opening a
  // second one under the same key.
  if (options.id !== undefined && state.tabs.some((tab) => tab.id === options.id)) {
    return focusTab(state, options.id)
  }
  const id = options.id ?? `tab-${state.nextNumber}`
  return {
    tabs: [...state.tabs, { id, title: options.title ?? NEW_CHAT_TITLE }],
    activeId: id,
    nextNumber: state.nextNumber + 1,
  }
}

export function activeTab(state: TabSet): Tab | null {
  return state.tabs.find((tab) => tab.id === state.activeId) ?? null
}

/** Focuses a Tab that exists; an unknown id or the current Tab is a no-op. */
export function focusTab(state: TabSet, id: string): TabSet {
  if (state.activeId === id) return state
  if (!state.tabs.some((tab) => tab.id === id)) return state
  return { ...state, activeId: id }
}

function step(state: TabSet, delta: number): TabSet {
  if (state.tabs.length < 2 || state.activeId === null) return state
  const index = state.tabs.findIndex((tab) => tab.id === state.activeId)
  if (index < 0) return state
  const next = state.tabs[(index + delta + state.tabs.length) % state.tabs.length]!
  return { ...state, activeId: next.id }
}

/** Moves to the next Tab, wrapping past the last one. */
export function nextTab(state: TabSet): TabSet {
  return step(state, 1)
}

/** Moves to the previous Tab, wrapping before the first one. */
export function previousTab(state: TabSet): TabSet {
  return step(state, -1)
}

/** Jumps to a 1-based position; a position that does not exist changes nothing. */
export function jumpToTab(state: TabSet, position: number): TabSet {
  const tab = state.tabs[position - 1]
  return tab ? focusTab(state, tab.id) : state
}

/** Sets a Tab's title; an unknown id or the same title returns the same set. */
export function setTabTitle(state: TabSet, id: string, title: string): TabSet {
  const tab = state.tabs.find((candidate) => candidate.id === id)
  if (!tab || tab.title === title) return state
  return {
    ...state,
    tabs: state.tabs.map((candidate) =>
      candidate.id === id ? { ...candidate, title } : candidate,
    ),
  }
}

/**
 * The first thing the user said, whitespace collapsed to a single line — the
 * fallback title for a Tab that has not been named. Attachments are not text
 * and are skipped; an empty message is not a title. Inline code is flattened to
 * its text, because the Tab Bar is plain prose and would otherwise show the
 * backticks the chat renders as chips.
 */
export function firstUserMessage(messages: Message[]): string | undefined {
  for (const message of messages) {
    if (message.role !== "user") continue
    const raw = message.content
      .flatMap((content) => (content.type === "text" ? [content.text] : []))
      .join(" ")
    if (!raw.trim()) continue
    const plain = tokenizeCodeText(raw)
      .map((segment) => segment.text)
      .join("")
      .replace(/\s+/g, " ")
      .trim()
    if (plain) return plain
  }
  return undefined
}

/**
 * A Tab's title: the Session name, then the start of the first message, then
 * `New chat`. Truncation to the Bar's width is its job, not the title's.
 */
export function tabTitle(source: { name?: string; firstUserMessage?: string }): string {
  const name = source.name?.replace(/\s+/g, " ").trim()
  if (name) return name
  const message = source.firstUserMessage?.replace(/\s+/g, " ").trim()
  return message || NEW_CHAT_TITLE
}
