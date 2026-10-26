import { Box, Text } from "ink"
import { COLORS, ICONS } from "./theme"
import { TAB_CHROME_WIDTH, layoutTabBar, type TabBarTab } from "./tab-bar-layout"

/** The Tab Bar is chrome: one row, never two, with no shade of its own. */
export const TAB_BAR_HEIGHT = 1

const ELLIPSIS = "…"

export interface TabBarItem extends TabBarTab {
  id: string
}

export interface TabBarProps {
  tabs: TabBarItem[]
  width: number
}

/** Cuts a title to the width it was given, marking the cut rather than wrapping. */
export function truncateTabTitle(title: string, maxWidth: number): string {
  if (maxWidth <= 0) return ""
  if (title.length <= maxWidth) return title
  if (maxWidth === 1) return ELLIPSIS
  return `${title.slice(0, maxWidth - 1)}${ELLIPSIS}`
}

/**
 * The Tab Bar: every Tab in view in order, then the `+` control immediately
 * after the last one. Display only — it holds no state and binds no keys, so it
 * can be asserted on directly. `+` is a keyboard affordance (Ctrl+T): the
 * terminal has no pointer, and mouse input stays noise. The active Tab carries
 * `×` (Ctrl+X), the keyboard surface's way of saying the close control is on the
 * Tab you are looking at; no other Tab shows one.
 *
 * Where the slots go is {@link layoutTabBar}'s job: titles keep their full width
 * while every Tab fits, then equal slots shrink to the readable floor, and past
 * that the Bar shows a window of Tabs and scrolls to keep the active one in
 * view, so it never wraps and never takes a second row.
 */
export function TabBar({ tabs, width }: TabBarProps) {
  const slots = layoutTabBar(tabs, width)

  return (
    <Box height={TAB_BAR_HEIGHT} flexShrink={0} overflow="hidden">
      <Text wrap="truncate-end">
        {slots.map((slot) => {
          const tab = tabs[slot.index]
          if (!tab) return null
          // Every Tab reserves the cells the close control uses, so moving focus
          // marks a Tab without shifting the ones after it. A short title is
          // padded out to its slot, with the pad trailing the close control so
          // `×` stays next to the title it closes.
          const markerWidth = tab.status ? 2 : 0
          const titleWidth = Math.max(1, slot.width - TAB_CHROME_WIDTH - markerWidth)
          const title = truncateTabTitle(tab.title, titleWidth)
          const gap = " ".repeat(Math.max(0, titleWidth - title.length) + 1)
          const marker =
            tab.status === "approval"
              ? { glyph: ICONS.warning, color: COLORS.warning }
              : tab.status === "error"
                ? { glyph: ICONS.cross, color: COLORS.error }
                : tab.status === "streaming"
                  ? { glyph: ICONS.dot, color: COLORS.primary }
                  : null
          return (
            <Text key={tab.id} color={tab.active ? COLORS.primary : COLORS.muted} bold={tab.active}>
              {marker && <Text color={marker.color}>{`${marker.glyph} `}</Text>}
              {` ${title}${tab.active ? " ×" : "  "}${gap}`}
            </Text>
          )
        })}
        {/* `+` follows the last Tab in view, never pinned to the far edge. */}
        <Text color={COLORS.muted}>+</Text>
      </Text>
    </Box>
  )
}
