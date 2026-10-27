/** The narrowest a Tab is allowed to get before the Tab Bar scrolls instead. */
export const TAB_MIN_WIDTH = 12

/** Everything a Tab slot holds besides its title: the pads and the close cells. */
export const TAB_CHROME_WIDTH = 4

const PLUS_WIDTH = 1 // the bare "+"

/** What the Tab Bar layout needs to know about one Tab. */
export interface TabBarTab {
  title: string
  active: boolean
  status?: "streaming" | "approval" | "error"
}

/** One Tab in the Bar, with the columns it occupies there. */
export interface TabBarSlot {
  /** Position in the Tab set. */
  index: number
  /** Columns the Tab occupies, title and chrome together. */
  width: number
}

function naturalSlotWidth(title: string): number {
  return Math.max(1, title.length) + TAB_CHROME_WIDTH
}

/**
 * Places the Tabs in the Bar: everyone at full title width while they fit, then
 * equal slots that shrink to {@link TAB_MIN_WIDTH}, and past that a window of
 * Tabs that scrolls to keep the active one in view. `+` always follows the last
 * Tab in view, so the Bar stays one row and the control stays near the Tabs it
 * belongs to. Pure arithmetic — no React, no terminal.
 */
export function layoutTabBar(tabs: readonly TabBarTab[], width: number): TabBarSlot[] {
  const available = Math.max(1, Math.floor(width))
  if (tabs.length === 0) return []

  const widths = tabs.map((tab) => naturalSlotWidth(tab.title) + (tab.status ? 2 : 0))
  const total = widths.reduce((sum, value) => sum + value, 0) + PLUS_WIDTH
  if (total <= available) {
    return widths.map((tabWidth, index) => ({ index, width: tabWidth }))
  }

  const usable = Math.max(1, available - PLUS_WIDTH)
  const floorWidth = Math.min(TAB_MIN_WIDTH, usable)
  const visibleAtFloor = Math.max(1, Math.floor(usable / floorWidth))
  if (visibleAtFloor >= tabs.length) {
    const slotWidth = Math.max(1, Math.floor(usable / tabs.length))
    return tabs.map((_, index) => ({ index, width: slotWidth }))
  }

  const activeIndex = Math.max(
    0,
    tabs.findIndex((tab) => tab.active),
  )
  const lastStart = tabs.length - visibleAtFloor
  const startIndex = Math.min(
    Math.max(0, activeIndex - visibleAtFloor + 1),
    lastStart,
  )
  return Array.from({ length: visibleAtFloor }, (_, offset) => ({
    index: startIndex + offset,
    width: floorWidth,
  }))
}

/** What a click on the Bar landed on. */
export type TabBarHit =
  | {
      kind: "tab"
      /** Position in the Tab set, not in the visible window. */
      index: number
      /** True when the click landed on the active Tab's `×`. */
      close: boolean
    }
  | { kind: "plus" }

/**
 * Maps a 0-based column on the Bar back to the Tab (or the `+`) it belongs to,
 * using the same {@link layoutTabBar} slots the Bar is drawn from. The close
 * cell is the `×` on the active Tab — the only place a close is offered — and a
 * click anywhere else inside a Tab focuses it.
 */
export function hitTestTabBar(
  tabs: readonly TabBarTab[],
  width: number,
  column: number,
): TabBarHit | null {
  if (column < 0) return null
  let start = 0
  for (const slot of layoutTabBar(tabs, width)) {
    const tab = tabs[slot.index]
    if (!tab) continue
    if (column < start + slot.width) {
      const markerWidth = tab.status ? 2 : 0
      const titleWidth = Math.max(1, slot.width - TAB_CHROME_WIDTH - markerWidth)
      // truncateTabTitle cuts to exactly titleWidth once the title overflows.
      const shownTitle = Math.min(tab.title.length, titleWidth)
      // marker, leading pad, title, then the space of " ×".
      const closeColumn = start + markerWidth + 1 + shownTitle + 1
      return {
        kind: "tab",
        index: slot.index,
        close: tab.active && column === closeColumn,
      }
    }
    start += slot.width
  }
  return column === start ? { kind: "plus" } : null
}
