import { Box, Text } from "ink"
import { COLORS, ICONS } from "./theme"

/** How many lines of the copied text the popup shows before eliding the rest. */
export const COPY_PREVIEW_LINES = 5

/**
 * The copied text as the popup shows it: the first few lines, each cut to the
 * popup's inner width, with an ellipsis standing in for anything left out. The
 * popup reports what was copied without turning a long reply into a full-screen
 * wall of text.
 */
export function copyPreviewLines(text: string, innerWidth: number): string[] {
  const lines = text.replace(/\r\n/g, "\n").split("\n")
  const width = Math.max(8, innerWidth)
  const preview = lines.slice(0, COPY_PREVIEW_LINES).map((line) =>
    line.length > width ? `${line.slice(0, width - 1)}…` : line,
  )
  if (lines.length > COPY_PREVIEW_LINES) preview.push("…")
  return preview
}

interface CopyPopupProps {
  /** The window's width, so the box never reaches past the chat panel. */
  width: number
  text: string
  count: number
}

/** A short-lived receipt that says what just went to the clipboard. */
export function CopyPopup({ width, text, count }: CopyPopupProps) {
  const boxWidth = Math.max(16, Math.min(64, width - 4))
  const preview = copyPreviewLines(text, boxWidth - 4)
  return (
    <Box
      flexDirection="column"
      width={boxWidth}
      borderStyle="round"
      borderColor={COLORS.success}
      backgroundColor={COLORS.panelShade}
      paddingX={1}
    >
      <Text color={COLORS.success} bold>
        {ICONS.check} Copied {count === 1 ? "message" : `${count} messages`} to clipboard
      </Text>
      <Box flexDirection="column" marginTop={1}>
        {preview.map((line, index) => (
          <Text key={index} color={COLORS.text} wrap="truncate-end">
            {line || " "}
          </Text>
        ))}
      </Box>
      <Box marginTop={1}>
        <Text color={COLORS.muted} italic>
          Press any key to dismiss
        </Text>
      </Box>
    </Box>
  )
}
