import { Box, Text } from "ink"
import { COLORS, ICONS } from "./theme"

export interface PendingConfirmation {
  message: string
  resolve: (confirmed: boolean) => void
}

interface ConfirmPromptProps {
  message: string
  /** What `y` agrees to. Spelled out so the keys are not the only clue. */
  confirmLabel: string
}

/**
 * A yes/no the user has to answer before something proceeds.
 *
 * The warning is in full here rather than trimmed to fit: a switch that will
 * drop history is only safe to accept if the user can read how much.
 */
export function ConfirmPrompt({ message, confirmLabel }: ConfirmPromptProps) {
  return (
    <Box flexDirection="column" flexShrink={0} borderStyle="double"
         borderColor={COLORS.warning} paddingX={1} paddingY={1}>
      <Text color={COLORS.warning} bold>
        {ICONS.warning} Confirm
      </Text>
      <Box marginTop={1}>
        <Text color={COLORS.text} wrap="wrap">{message}</Text>
      </Box>
      <Box marginTop={1}>
        <Text color={COLORS.success}>[y]</Text>
        <Text color={COLORS.muted}> {confirmLabel} </Text>
        <Text color={COLORS.error}>[n]</Text>
        <Text color={COLORS.muted}> Cancel</Text>
      </Box>
      <Text color={COLORS.muted}>Esc also cancels.</Text>
    </Box>
  )
}
