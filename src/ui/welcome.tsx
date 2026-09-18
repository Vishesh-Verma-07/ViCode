import React, { useState, useRef } from "react"
import { Box, Text, useInput } from "ink"
import { COLORS, ICONS, ASCII_BANNER } from "./theme"
import type { Provider } from "../core/provider"
import { formatCost, formatTokens } from "../core/cost-calculator"
import { filterMouseInput, MOUSE_INPUT_FILTER_INITIAL, type MouseInputFilterState } from "./mouse"
import { deletePreviousWord } from "./word-delete"

interface WelcomeScreenProps {
  provider: Provider
  onNewChat: () => void
  onResumeSession?: () => void
  hasResumableSession?: boolean
  onSendFirstMessage: (input: string) => void
}

export function WelcomeScreen({ provider, onNewChat, onResumeSession, hasResumableSession, onSendFirstMessage }: WelcomeScreenProps) {
  const [inputValue, setInputValue] = useState("")
  const [selectedIndex, setSelectedIndex] = useState(0)
  const filterStateRef = useRef<MouseInputFilterState>(MOUSE_INPUT_FILTER_INITIAL)
  const modelInfo = provider.getModelInfo()

  const menuItems = [
    { label: "New Chat", description: "Start a fresh conversation" },
    ...(hasResumableSession
      ? [{ label: "Resume Session", description: "Continue where you left off" }]
      : []),
  ]

  useInput((input, key) => {
    if (key.upArrow) {
      setSelectedIndex((prev) => Math.max(0, prev - 1))
      return
    }
    if (key.downArrow) {
      setSelectedIndex((prev) => Math.min(menuItems.length - 1, prev + 1))
      return
    }
    if (key.return) {
      if (inputValue.trim()) {
        onSendFirstMessage(inputValue)
      } else if (menuItems[selectedIndex]) {
        if (selectedIndex === 0) onNewChat()
        else if (selectedIndex === 1 && onResumeSession) onResumeSession()
      }
      return
    }
    if ((key.ctrl && (input === "w" || input === "\u0017")) || ((key.backspace || key.delete) && (key.ctrl || key.meta))) {
      setInputValue((prev) => deletePreviousWord(prev))
      return
    }
    if (key.backspace || key.delete) {
      if (inputValue.length > 0) setInputValue((prev) => prev.slice(0, -1))
      return
    }
    if (key.ctrl && input === "c") {
      process.exit(0)
    }
    if (!input || key.ctrl || key.meta || key.escape || key.tab) return
    const result = filterMouseInput(input, filterStateRef.current)
    filterStateRef.current = result.state
    if (result.keptInput.length > 0) {
      setInputValue((prev) => prev + result.keptInput)
    }
  })

  return (
    <Box flexDirection="column" alignItems="center" justifyContent="center" height="100%" paddingX={2}>
      <Box flexDirection="column" alignItems="center" marginBottom={1}>
        <Text color={COLORS.primary} bold>
          {ASCII_BANNER}
        </Text>
        <Box marginTop={1}>
          <Text color={COLORS.muted}>
            {ICONS.sparkle} AI-Powered Coding Assistant made by vishesh verma {ICONS.sparkle}
          </Text>
        </Box>
      </Box>

      <Box flexDirection="column" alignItems="center" marginTop={1} marginBottom={1}>
        <Text color={COLORS.muted}>
          Model: <Text color={COLORS.text} bold>{modelInfo.name}</Text>
        </Text>
      </Box>

      <Box flexDirection="column" marginTop={1} width={50}>
        {menuItems.map((item, i) => {
          const isSelected = i === selectedIndex
          return (
            <Box key={item.label} flexDirection="column" marginBottom={0}>
              <Text
                color={isSelected ? COLORS.primary : COLORS.muted}
                bold={isSelected}
              >
                {isSelected ? `${ICONS.chevron} ` : "  "}
                {item.label}
              </Text>
              {isSelected && (
                <Text color={COLORS.dimText} wrap="truncate-end">
                  {"    "}{item.description}
                </Text>
              )}
            </Box>
          )
        })}
      </Box>

      <Box marginTop={2} width={50} flexDirection="column">
        <Box backgroundColor={COLORS.inputShade} paddingX={2} paddingY={1}>
          <Text>
            <Text color={COLORS.primary} bold>{ICONS.arrow} </Text>
            {inputValue ? (
              <Text>{inputValue}</Text>
            ) : (
              <Text color={COLORS.muted} italic>Ask anything or select an option...</Text>
            )}
            <Text inverse> </Text>
          </Text>
        </Box>
      </Box>

      <Box marginTop={1}>
        <Text color={COLORS.dimText}>
          ↑↓ Navigate  •  Enter Select  •  Type to start chatting  •  Ctrl+C Exit
        </Text>
      </Box>
    </Box>
  )
}
