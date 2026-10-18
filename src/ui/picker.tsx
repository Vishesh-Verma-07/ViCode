import React, { useEffect, useState } from "react"
import { Box, Text, useInput } from "ink"
import type { PickerItem, PickerRequest } from "../core/types"
import { moveHighlight } from "./command-suggestion"
import { deletePreviousWord } from "./word-delete"
import { COLORS } from "./theme"

interface PickerProps extends PickerRequest {
  onSelect: (index: number) => void
  onCancel: () => void
  rows?: number
}

/**
 * A selectable list. Up/Down move, typing filters, Enter selects, Escape
 * cancels.
 *
 * When the caller supplies `onDelete`/`onRename`, the picker also acts on the
 * highlighted row in place rather than making the user close it and run a
 * second command: Ctrl+D asks once and deletes, Ctrl+R takes a name. The item
 * list lives here once open, so a delete or rename is visible immediately and
 * the user can keep pruning until they press Enter or Escape.
 */
export function Picker({
  title,
  items,
  onSelect,
  onCancel,
  rows = 24,
  defaultIndex = 0,
  hint,
  onDelete,
  onRename,
}: PickerProps) {
  const [localItems, setLocalItems] = useState(items)
  const [highlighted, setHighlighted] = useState(defaultIndex)
  const [query, setQuery] = useState("")
  const [pendingDelete, setPendingDelete] = useState<PickerItem | null>(null)
  const [renaming, setRenaming] = useState<{ item: PickerItem; buffer: string } | null>(null)
  const maxVisible = Math.max(1, Math.floor(rows * 0.18))
  const [scrollOffset, setScrollOffset] = useState(
    defaultIndex >= maxVisible ? defaultIndex - maxVisible + 1 : 0,
  )

  // The caller normally hands the same list for the life of the picker; this
  // only matters when it changes the items out from under us.
  useEffect(() => {
    setLocalItems(items)
  }, [items])

  const matches = localItems
    .map((item, index) => ({ item, index }))
    .filter(({ item }) => item.label.toLowerCase().includes(query.toLowerCase()))

  const clampedStart = Math.max(
    0,
    Math.min(scrollOffset, Math.max(0, Math.min(highlighted, highlighted - maxVisible + 1))),
  )
  const visible = matches.slice(clampedStart, clampedStart + maxVisible)

  const removeItem = (item: PickerItem) => {
    const remaining = localItems.filter(
      (i) => i !== item && i.label.toLowerCase().includes(query.toLowerCase()),
    ).length
    setLocalItems((prev) => prev.filter((i) => i !== item))
    setHighlighted((prev) => Math.min(prev, Math.max(0, remaining - 1)))
  }

  useInput((input, key) => {
    // A pending question or a name prompt owns every key until it is answered,
    // the same way the App's own confirmation does.
    if (pendingDelete) {
      const lower = input.toLowerCase()
      if (lower === "y") {
        onDelete?.(pendingDelete)
        removeItem(pendingDelete)
        setPendingDelete(null)
      } else if (lower === "n" || key.escape) {
        setPendingDelete(null)
      }
      return
    }

    if (renaming) {
      if (key.return) {
        const name = renaming.buffer.trim()
        const newLabel = onRename?.(renaming.item, name)
        if (typeof newLabel === "string") {
          setLocalItems((prev) =>
            prev.map((i) => (i === renaming.item ? { ...i, label: newLabel } : i)),
          )
        }
        setRenaming(null)
      } else if (key.escape) {
        setRenaming(null)
      } else if (key.backspace || key.delete) {
        setRenaming((prev) => (prev ? { ...prev, buffer: prev.buffer.slice(0, -1) } : prev))
      } else if (input && !key.ctrl && !key.meta && input !== "\t") {
        setRenaming((prev) => (prev ? { ...prev, buffer: prev.buffer + input } : prev))
      }
      return
    }

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
    } else if (onDelete && key.ctrl && (input === "d" || input === "\u0004")) {
      const match = matches[highlighted]
      if (match) setPendingDelete(match.item)
    } else if (onRename && key.ctrl && (input === "r" || input === "\u0012")) {
      const match = matches[highlighted]
      if (match) setRenaming({ item: match.item, buffer: "" })
    } else if ((key.backspace || key.delete) && (key.ctrl || key.meta)) {
      setQuery((prev) => deletePreviousWord(prev))
      setHighlighted(0)
      setScrollOffset(0)
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
    <Box flexDirection="column" flexShrink={0} borderStyle="round" borderColor={COLORS.primary} paddingX={1}>
      <Text bold color={COLORS.primary}>
        {title}
      </Text>
      {pendingDelete ? (
        <Text color={COLORS.warning} wrap="truncate-end">
          Delete {pendingDelete.label}? [y] Delete [n] Cancel
        </Text>
      ) : renaming ? (
        <Text color={COLORS.primary} wrap="truncate-end">
          New name for {renaming.item.label}: {renaming.buffer}
          <Text inverse> </Text>
        </Text>
      ) : (
        <Text color={query ? COLORS.primary : COLORS.muted} wrap="truncate-end">
          {query ? `Search: ${query}` : "Type to search | Up/Down | Enter | Esc"}
        </Text>
      )}
      {matches.length === 0 ? (
        <Text color={COLORS.muted} italic>
          No matching items
        </Text>
      ) : (
        <>
          {visible.map(({ item, index }, i) => {
            const isHighlighted = clampedStart + i === highlighted
            return (
              <Box key={`${item.label}_${index}`} flexDirection="column">
                <Text color={isHighlighted ? COLORS.primary : undefined} bold={isHighlighted}>
                  {isHighlighted ? "> " : "  "}
                  {item.label}
                </Text>
                {item.metadata && <Text color={COLORS.muted}>  {item.metadata}</Text>}
              </Box>
            )
          })}
          {matches.length > maxVisible && (
            <Text color={COLORS.muted}>
              ({clampedStart + 1}-{Math.min(clampedStart + maxVisible, matches.length)} of {matches.length})
            </Text>
          )}
        </>
      )}
      {hint && (
        <Text color={COLORS.muted} wrap="truncate-end">
          {hint}
        </Text>
      )}
    </Box>
  )
}
