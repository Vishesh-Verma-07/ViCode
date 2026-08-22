import React, { useState } from "react"
import { Box, Text, useInput } from "ink"
import type { PickerRequest } from "../core/types"
import { moveHighlight } from "./command-suggestion"

interface PickerProps extends PickerRequest {
  onSelect: (index: number) => void
  onCancel: () => void
}

export function Picker({ title, items, onSelect, onCancel }: PickerProps) {
  const [highlighted, setHighlighted] = useState(0)

  useInput((_input, key) => {
    if (items.length === 0) {
      if (key.escape) onCancel()
      return
    }
    if (key.upArrow) {
      setHighlighted((prev) => moveHighlight(prev, items.length, -1))
    } else if (key.downArrow) {
      setHighlighted((prev) => moveHighlight(prev, items.length, 1))
    } else if (key.return) {
      onSelect(highlighted)
    } else if (key.escape) {
      onCancel()
    }
  })

  return (
    <Box flexDirection="column" borderStyle="round" borderColor="cyan" paddingX={1}>
      <Text bold color="cyan">
        {title}
      </Text>
      {items.length === 0 ? (
        <Text color="gray" italic>
          No items
        </Text>
      ) : (
        items.map((item, i) => (
          <Box key={`${item.label}_${i}`} flexDirection="column">
            <Text color={i === highlighted ? "cyan" : undefined} bold={i === highlighted}>
              {i === highlighted ? "> " : "  "}
              {item.label}
            </Text>
            {item.metadata && <Text color="gray">  {item.metadata}</Text>}
          </Box>
        ))
      )}
      <Box marginTop={1}>
        <Text color="gray">Up/Down: navigate | Enter: select | Esc: cancel</Text>
      </Box>
    </Box>
  )
}
