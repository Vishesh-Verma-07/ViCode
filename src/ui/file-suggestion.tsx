import React from "react"
import { Box, Text } from "ink"
import { COLORS } from "./theme"

export const NO_FILES_MATCH_MESSAGE = "no files match"
export const FILE_SUGGESTION_HINT = "Enter to attach · Esc to dismiss"

export interface FileSuggestionProps {
  /** Project-Root-relative paths, best match first. */
  items: string[]
  highlightIndex: number
}

/**
 * The dropdown that lists project files for the mention being typed. Rendered
 * above the Input Box, a sibling of the Command Suggestion: the two share a
 * shape but not a key — a command is the whole input and Enter runs it, while
 * a mention is a word inside a message and Enter only completes it.
 */
export function FileSuggestion({ items, highlightIndex }: FileSuggestionProps) {
  return (
    <Box flexDirection="column" borderStyle="round" borderColor={COLORS.primary} paddingX={1}>
      {items.length === 0 ? (
        <Text color={COLORS.muted} italic>
          {NO_FILES_MATCH_MESSAGE}
        </Text>
      ) : (
        items.map((file, i) => {
          const highlighted = i === highlightIndex
          return (
            <Box key={file}>
              <Text color={highlighted ? COLORS.primary : COLORS.muted} bold={highlighted}>
                {highlighted ? "> @" : "  @"}
                <Text color={highlighted ? COLORS.text : COLORS.muted}>{file}</Text>
              </Text>
            </Box>
          )
        })
      )}
      <Text color={COLORS.muted} wrap="truncate-end">
        {FILE_SUGGESTION_HINT}
      </Text>
    </Box>
  )
}
