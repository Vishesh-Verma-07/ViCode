import React, { useRef, useState } from "react"
import { Box, Text, useInput } from "ink"
import { filterMouseInput, MOUSE_INPUT_FILTER_INITIAL, type MouseInputFilterState } from "./mouse"
import { deletePreviousWord } from "./word-delete"
import { COLORS, ICONS } from "./theme"

const OPENROUTER_KEY_URL = "https://openrouter.ai/keys"
const KEY_PREFIX_HINT = /^sk-or-v1-/

interface KeyEntryScreenProps {
  requireKey?: boolean
  initialValue?: string
  onSubmit: (apiKey: string) => void
  onCancel?: () => void
}

export function KeyEntryScreen({
  requireKey = false,
  initialValue = "",
  onSubmit,
  onCancel,
}: KeyEntryScreenProps) {
  const [value, setValue] = useState(initialValue)
  const [warning, setWarning] = useState("")
  const [confirmOverride, setConfirmOverride] = useState(false)
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
      setWarning(`Enter your OpenRouter API key to continue. Get one at ${OPENROUTER_KEY_URL}`)
      return
    }
    if (!KEY_PREFIX_HINT.test(trimmed)) {
      if (!confirmOverride) {
        setConfirmOverride(true)
        setWarning(
          "This doesn't look like an OpenRouter key (expected sk-or-v1-...). Press Enter again to save anyway.",
        )
        return
      }
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
        `An API key is required to chat. Get one at ${OPENROUTER_KEY_URL} or press Ctrl+C to quit.`,
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
      const next = deletePreviousWord(valueRef.current)
      setConfirmOverride(false)
      commit(next)
      return
    }
    if (key.backspace || key.delete) {
      const next = valueRef.current.slice(0, -1)
      setConfirmOverride(false)
      commit(next)
      return
    }
    if (!input || key.ctrl || key.meta || key.tab || key.upArrow || key.downArrow || key.leftArrow || key.rightArrow || key.pageUp || key.pageDown || key.home || key.end) {
      return
    }
    const result = filterMouseInput(input, filterStateRef.current)
    filterStateRef.current = result.state
    if (result.keptInput.length > 0) {
      const wasConfirming = confirmOverride
      setConfirmOverride(false)
      setWarning("")
      if (wasConfirming) {
        commit(result.keptInput)
      } else {
        commit(valueRef.current + result.keptInput)
      }
    }
  })

  return (
    <Box flexDirection="column" borderStyle="round" borderColor={COLORS.primary} paddingX={2} paddingY={1} width={72} flexShrink={0}>
      <Text bold color={COLORS.primary}>
        {requireKey ? `${ICONS.dot} OpenRouter API key required` : "OpenRouter API key"}
      </Text>
      <Text color={COLORS.muted} wrap="truncate-end">
        Your key is stored in ~/.vicode/config.json and used for all projects. {requireKey ? "You need it to chat." : ""}
      </Text>
      <Box marginTop={1} backgroundColor={COLORS.inputShade} paddingX={2} paddingY={1}>
        <Text>
          <Text color={COLORS.primary} bold>{ICONS.arrow} </Text>
          {value ? (
            <Text color={COLORS.text}>{value}</Text>
          ) : (
            <Text color={COLORS.muted} italic>sk-or-v1-...</Text>
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
        <Text color={COLORS.dimText}>Get a key at https://openrouter.ai/keys</Text>
        <Text color={COLORS.dimText}>
          Enter Save • {requireKey ? "Esc Help" : "Esc Cancel"} • Ctrl+C {requireKey ? "Quit" : "Cancel"}
        </Text>
      </Box>
    </Box>
  )
}