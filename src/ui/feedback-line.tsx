import { Box, Text } from "ink"
import { COLORS, ICONS } from "./theme"

export type FeedbackTone = "info" | "warning" | "error"

export interface FeedbackEntry {
  id: string
  text: string
  tone: FeedbackTone
}

export function FeedbackLine({ text, tone }: { text: string; tone: FeedbackTone }) {
  return (
    <Box>
      <Text
        color={tone === "error" ? COLORS.error : tone === "warning" ? COLORS.warning : COLORS.primary}
        wrap="wrap"
      >
        {tone === "error" ? `${ICONS.cross} ` : tone === "warning" ? `${ICONS.warning} ` : `${ICONS.check} `}{text}
      </Text>
    </Box>
  )
}
