import React, { useRef, useState } from "react"
import { Box, Text, useInput } from "ink"
import { filterMouseInput, MOUSE_INPUT_FILTER_INITIAL, type MouseInputFilterState } from "./mouse"
import { deletePreviousWord } from "./word-delete"
import { COLORS, ICONS } from "./theme"
import { getProvider, type ProviderId } from "../core/providers"

interface KeyEntryScreenProps {
  /** The Provider whose key is being collected. */
  provider: ProviderId
  requireKey?: boolean
  initialValue?: string
  onSubmit: (apiKey: string) => void
  onCancel?: () => void
}

/**
 * No key-format validation. OpenRouter's `sk-or-v1-` prefix was the only one
 * ever verifiable, and the vendors do not document theirs — rejecting an
 * unfamiliar key would block valid ones. An empty key is still refused,
 * because that is never useful.
 */
export function KeyEntryScreen({
  provider,
  requireKey = false,
  initialValue = "",
  onSubmit,
  onCancel,
}: KeyEntryScreenProps) {
  const descriptor = getProvider(provider)
  const [value, setValue] = useState(initialValue)
  const [warning, setWarning] = useState("")
  const [saved, setSaved] = useState(false)
  const filterStateRef = useRef<MouseInputFilterState>(MOUSE_INPUT_FILTER_INITIAL)
  const valueRef = useRef(value)

  const commit = (next: string) => {
    valueRef.current = next
    setValue(next)
  }

  const submit = () => {
    const trimmed = valueRef.current.trim()
    if (!trimmed) {
      setWarning(`Enter your ${descriptor.label} API key to continue. Get one at ${descriptor.keyUrl}`)
      return
    }
    setSaved(true)
    onSubmit(trimmed)
  }

  if (saved) {
    return (
      <Box flexDirection="column" width={72} flexShrink={0}>
        <Text color={COLORS.success}>{ICONS.check} API key saved. Closing…</Text>
      </Box>
    )
  }

  const cancel = () => {
    if (requireKey) {
      setWarning(
        `An API key is required to chat on ${descriptor.label}. Get one at ${descriptor.keyUrl} or press Ctrl+C to quit.`,
      )
      return
    }
    onCancel?.()
  }

  useInput((input, key) => {
    if (key.return) {
      submit()
      return
    }
    if (key.escape) {
      cancel()
      return
    }
    if (key.ctrl && input === "c") {
      if (requireKey) process.exit(0)
      onCancel?.()
      return
    }
    if (
      (key.ctrl && (input === "w" || input === "\u0017")) ||
      ((key.backspace || key.delete) && (key.ctrl || key.meta))
    ) {
      commit(deletePreviousWord(valueRef.current))
      return
    }
    if (key.backspace || key.delete) {
      commit(valueRef.current.slice(0, -1))
      return
    }
    if (!input || key.ctrl || key.meta || key.tab || key.upArrow || key.downArrow || key.leftArrow || key.rightArrow || key.pageUp || key.pageDown || key.home || key.end) {
      return
    }
    const result = filterMouseInput(input, filterStateRef.current)
    filterStateRef.current = result.state
    if (result.keptInput.length > 0) {
      setWarning("")
      commit(valueRef.current + result.keptInput)
    }
  })

  return (
    <Box flexDirection="column" borderStyle="round" borderColor={COLORS.primary} paddingX={2} paddingY={1} width={72} flexShrink={0}>
      <Text bold color={COLORS.primary}>
        {requireKey ? `${ICONS.dot} ${descriptor.label} API key required` : `${descriptor.label} API key`}
      </Text>
      <Text color={COLORS.muted} wrap="truncate-end">
        Stored in ~/.vicode/config.json and used for all projects.
      </Text>
      {requireKey ? (
        <Text color={COLORS.muted} wrap="truncate-end">
          You need one to chat on this provider.
        </Text>
      ) : (
        <Text color={COLORS.muted} wrap="truncate-end">
          Other providers keep their own keys.
        </Text>
      )}
      <Box marginTop={1} backgroundColor={COLORS.inputShade} paddingX={2} paddingY={1}>
        <Text>
          <Text color={COLORS.primary} bold>{ICONS.arrow} </Text>
          {value ? (
            <Text color={COLORS.text}>{value}</Text>
          ) : (
            <Text color={COLORS.muted} italic>paste your key</Text>
          )}
          <Text inverse> </Text>
        </Text>
      </Box>
      {warning ? (
        <Text color={COLORS.warning} wrap="truncate-end">
          {ICONS.warning} {warning}
        </Text>
      ) : null}
      <Box marginTop={1} flexDirection="column">
        <Text color={COLORS.dimText}>Get a key at {descriptor.keyUrl}</Text>
        <Text color={COLORS.dimText}>
          Enter Save • {requireKey ? "Esc Help" : "Esc Cancel"} • Ctrl+C {requireKey ? "Quit" : "Cancel"}
        </Text>
      </Box>
    </Box>
  )
}