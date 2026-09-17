import { Box, Text } from "ink"
import { COLORS, ICONS } from "./theme"

export type FeedbackTone = "info" | "error"

export interface FeedbackEntry {
  id: string
  text: string
  tone: FeedbackTone
}

export function FeedbackLine({ text, tone }: { text: string; tone: FeedbackTone }) {
  return (
    <Box marginBottom={1}>
      <Text color={tone === "error" ? COLORS.error : COLORS.primary} wrap="wrap">
        {tone === "error" ? `${ICONS.cross} ` : `${ICONS.check} `}{text}
      </Text>
    </Box>
  )
}
