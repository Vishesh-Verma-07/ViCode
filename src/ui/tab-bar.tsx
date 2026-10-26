import { Box, Text } from "ink"
import { COLORS } from "./theme"

/** The Tab Bar is chrome: one row, never two, with no shade of its own. */
export const TAB_BAR_HEIGHT = 1

const ELLIPSIS = "…"
const TAB_PADDING = 2 // one space on each side of a title
const CLOSE_WIDTH = 2 // " ×" on the active Tab, blank on the others

export interface TabBarItem {
  id: string
  title: string
  active: boolean
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
 * The Tab Bar: every Tab in order, then the `+` control immediately after the
 * last one. Display only — it holds no state and binds no keys, so it can be
 * asserted on directly. `+` is a keyboard affordance (Ctrl+T): the terminal has
 * no pointer, and mouse input stays noise. The active Tab carries `×` (Ctrl+X),
 * the keyboard surface's way of saying the close control is on the Tab you are
 * looking at; no other Tab shows one.
 *
 * Equal slots with a title cut to fit keep it one row high. Shrinking to a
 * readable floor and then scrolling is the crowded-Bar work, later.
 */
export function TabBar({ tabs, width }: TabBarProps) {
  const slots = tabs.length + 1
  const perSlot = Math.max(1, Math.floor(Math.max(1, width) / Math.max(1, slots)))

  return (
    <Box height={TAB_BAR_HEIGHT} flexShrink={0} overflow="hidden">
      <Text wrap="truncate-end">
        {tabs.map((tab) => {
          // Every Tab reserves the cells the close control uses, so moving focus
          // marks a Tab without shifting the ones after it. A title that fits
          // is not padded to the slot; only the close columns are fixed.
          const titleWidth = Math.max(1, perSlot - TAB_PADDING - CLOSE_WIDTH)
          return (
            <Text key={tab.id} color={tab.active ? COLORS.primary : COLORS.muted} bold={tab.active}>
              {` ${truncateTabTitle(tab.title, titleWidth)}${tab.active ? " ×" : "  "} `}
            </Text>
          )
        })}
        <Text color={COLORS.muted}>+</Text>
      </Text>
    </Box>
  )
}
