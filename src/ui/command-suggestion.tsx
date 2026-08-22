import React from "react"
import { Box, Text } from "ink"
import type { Command } from "../core/types"

export const NO_COMMANDS_MATCH_MESSAGE = "no commands match"

export function filterCommands(commands: Command[], query: string): Command[] {
  const fragment = (query.startsWith("/") ? query.slice(1) : query).toLowerCase()
  return commands.filter((command) => command.name.toLowerCase().startsWith(fragment))
}

export function moveHighlight(previous: number, length: number, delta: -1 | 1): number {
  return Math.max(0, Math.min(length - 1, previous + delta))
}

export interface CommandSuggestionProps {
  items: Command[]
  highlightIndex: number
}

export function CommandSuggestion({ items, highlightIndex }: CommandSuggestionProps) {
  return (
    <Box flexDirection="column" borderStyle="round" borderColor="cyan" paddingX={1}>
      {items.length === 0 ? (
        <Text color="gray" italic>
          {NO_COMMANDS_MATCH_MESSAGE}
        </Text>
      ) : (
        items.map((command, i) => {
          const highlighted = i === highlightIndex
          return (
            <Box key={command.name}>
              <Text color={highlighted ? "cyan" : undefined} bold={highlighted}>
                {highlighted ? "> " : "  "}
                /{command.name}
                <Text color="gray"> - {command.description}</Text>
              </Text>
            </Box>
          )
        })
      )}
    </Box>
  )
}
