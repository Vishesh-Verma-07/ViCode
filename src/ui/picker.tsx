import React, { useState } from "react"
import { Box, Text, useInput } from "ink"
import type { PickerRequest } from "../core/types"
import { moveHighlight } from "./command-suggestion"

interface PickerProps extends PickerRequest {
  onSelect: (index: number) => void
  onCancel: () => void
  rows?: number
}

export function Picker({ title, items, onSelect, onCancel, rows = 24 }: PickerProps) {
  const [highlighted, setHighlighted] = useState(0)
  const [query, setQuery] = useState("")
  const [scrollOffset, setScrollOffset] = useState(0)

  const matches = items
    .map((item, index) => ({ item, index }))
    .filter(({ item }) => item.label.toLowerCase().includes(query.toLowerCase()))

  const maxVisible = Math.max(1, Math.floor(rows * 0.18))
  const clampedStart = Math.max(
    0,
    Math.min(scrollOffset, Math.max(0, Math.min(highlighted, highlighted - maxVisible + 1))),
  )
  const visible = matches.slice(clampedStart, clampedStart + maxVisible)

  useInput((input, key) => {
    if (key.upArrow || key.downArrow) {
      const next = moveHighlight(highlighted, matches.length, key.upArrow ? -1 : 1)
      setHighlighted(next)
      let start = clampedStart
      if (next < clampedStart) start = next
      else if (next >= clampedStart + maxVisible) start = next - maxVisible + 1
      setScrollOffset(Math.max(0, start))
    } else if (key.return) {
      const match = matches[highlighted]
      if (match) onSelect(match.index)
    } else if (key.escape) {
      onCancel()
    } else if (key.backspace || key.delete) {
      setQuery((prev) => prev.slice(0, -1))
      setHighlighted(0)
      setScrollOffset(0)
    } else if (input && !key.ctrl && !key.meta && input !== "\t") {
      setQuery((prev) => prev + input)
      setHighlighted(0)
      setScrollOffset(0)
    }
  })

  return (
    <Box flexDirection="column" borderStyle="round" borderColor="cyan" paddingX={1}>
      <Text bold color="cyan">
        {title}
      </Text>
      <Text color={query ? "cyan" : "gray"} wrap="truncate-end">
        {query ? `Search: ${query}` : "Type to search | Up/Down | Enter | Esc"}
      </Text>
      {matches.length === 0 ? (
        <Text color="gray" italic>
          No matching items
        </Text>
      ) : (
        <>
          {visible.map(({ item, index }, i) => {
            const isHighlighted = clampedStart + i === highlighted
            return (
              <Box key={`${item.label}_${index}`} flexDirection="column">
                <Text color={isHighlighted ? "cyan" : undefined} bold={isHighlighted}>
                  {isHighlighted ? "> " : "  "}
                  {item.label}
                </Text>
                {item.metadata && <Text color="gray">  {item.metadata}</Text>}
              </Box>
            )
          })}
          {matches.length > maxVisible && (
            <Text color="gray">
              ({clampedStart + 1}-{Math.min(clampedStart + maxVisible, matches.length)} of {matches.length})
            </Text>
          )}
        </>
      )}
    </Box>
  )
}
