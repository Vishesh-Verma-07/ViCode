import { useEffect, useRef } from "react"
import { Text, useInput } from "ink"
import { filterMouseInput, MOUSE_INPUT_FILTER_INITIAL, type MouseInputFilterState } from "./mouse"
import { COLORS, ICONS } from "./theme"

export function ChatInput({ value, placeholder, isDisabled, onChange }: { value: string; placeholder: string; isDisabled?: boolean; onChange: (value: string) => void }) {
  const filterStateRef = useRef<MouseInputFilterState>(MOUSE_INPUT_FILTER_INITIAL)
  const valueRef = useRef(value)

  useEffect(() => {
    valueRef.current = value
  }, [value])

  const commit = (next: string) => {
    valueRef.current = next
    onChange(next)
  }

  const deleteWord = () => {
    commit(valueRef.current.replace(/\s*\S+\s*$/, ""))
  }

  useInput((input, key) => {
    if (isDisabled) return
    if (
      key.return ||
      key.upArrow ||
      key.downArrow ||
      key.leftArrow ||
      key.rightArrow ||
      key.tab ||
      key.escape ||
      key.pageUp ||
      key.pageDown ||
      key.home ||
      key.end
    ) {
      return
    }
    if (
      (key.ctrl && (input === "w" || input === "\u0017")) ||
      ((key.backspace || key.delete) && (key.ctrl || key.meta))
    ) {
      deleteWord()
      return
    }
    if (key.backspace || key.delete) {
      if (valueRef.current.length > 0) commit(valueRef.current.slice(0, -1))
      return
    }
    if (!input) return
    const result = filterMouseInput(input, filterStateRef.current)
    filterStateRef.current = result.state
    if (result.keptInput.length > 0) {
      commit(valueRef.current + result.keptInput)
    }
  })

  return (
    <Text>
      <Text color={COLORS.primary} bold>{ICONS.arrow} </Text>
      {value ? <Text>{value}</Text> : <Text color={COLORS.muted}>{placeholder}</Text>}
      {!isDisabled && <Text inverse> </Text>}
    </Text>
  )
}
