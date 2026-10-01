import React from "react"
import { Box, Text } from "ink"
import type { Command } from "../core/types"
import { COLORS } from "./theme"

export const NO_COMMANDS_MATCH_MESSAGE = "no commands match"

export function filterCommands(commands: Command[], query: string): Command[] {
  const fragment = (query.startsWith("/") ? query.slice(1) : query).toLowerCase()
  return commands.filter((command) => command.name.toLowerCase().startsWith(fragment))
}

export function moveHighlight(previous: number, length: number, delta: -1 | 1): number {
  return Math.max(0, Math.min(length - 1, previous + delta))
}

export function findUsageHint(commands: Command[], input: string): string | undefined {
  const draft = input.trimStart()
  if (!draft.startsWith("/") || /\s/.test(draft)) return undefined
  return commands.find((command) => command.name === draft.slice(1))?.usage
}

export interface CommandSuggestionProps {
  items: Command[]
  highlightIndex: number
  hint?: string
}

export function CommandSuggestion({ items, highlightIndex, hint }: CommandSuggestionProps) {
  return (
    <Box flexDirection="column" borderStyle="round" borderColor={COLORS.primary} paddingX={1}>
      {items.length === 0 ? (
        <Text color={COLORS.muted} italic>
          {NO_COMMANDS_MATCH_MESSAGE}
        </Text>
      ) : (
        items.map((command, i) => {
          const highlighted = i === highlightIndex
          return (
            <Box key={command.name}>
              <Text color={highlighted ? COLORS.primary : undefined} bold={highlighted}>
                {highlighted ? "> " : "  "}
                /{command.name}
                <Text color={COLORS.muted}> - {command.description}</Text>
              </Text>
            </Box>
          )
        })
      )}
      {hint && (
        <Text color={COLORS.muted} wrap="truncate-end">
          {hint}
        </Text>
      )}
    </Box>
  )
}
