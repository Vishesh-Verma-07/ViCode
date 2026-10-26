import { Box, Text } from "ink"
import { COLORS } from "./theme"

/** The Tab Bar is chrome: one row, never two, with no shade of its own. */
export const TAB_BAR_HEIGHT = 1

const ELLIPSIS = "…"
const TAB_PADDING = 2 // one space on each side of a title

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
 * no pointer, and mouse input stays noise.
 *
 * Equal slots with a title cut to fit keep it one row high. Shrinking to a
 * readable floor and then scrolling is the crowded-Bar work, later.
 */
export function TabBar({ tabs, width }: TabBarProps) {
  const slots = tabs.length + 1
  const perSlot = Math.max(1, Math.floor(Math.max(1, width) / Math.max(1, slots)))
  const titleWidth = Math.max(1, perSlot - TAB_PADDING)

  return (
    <Box height={TAB_BAR_HEIGHT} flexShrink={0} overflow="hidden">
      <Text wrap="truncate-end">
        {tabs.map((tab) => (
          <Text key={tab.id} color={tab.active ? COLORS.primary : COLORS.muted} bold={tab.active}>
            {` ${truncateTabTitle(tab.title, titleWidth)} `}
          </Text>
        ))}
        <Text color={COLORS.muted}>+</Text>
      </Text>
    </Box>
  )
}
