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
