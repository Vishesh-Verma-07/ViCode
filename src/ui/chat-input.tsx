import { useEffect, useRef, useState } from "react"
import { useInput } from "ink"
import { filterMouseInput, MOUSE_INPUT_FILTER_INITIAL, type MouseInputFilterState } from "./mouse"
import { CursorText } from "./cursor-text"
import {
  backspaceAt,
  clampToEnd,
  deleteAt,
  insertAt,
  moveLeft,
  moveRight,
  moveToEnd,
  moveToHome,
  wordDeleteAt,
  type CursorState,
} from "./cursor-edit"

export function ChatInput({ value, placeholder, isDisabled, onChange, onTab }: { value: string; placeholder: string; isDisabled?: boolean; onChange: (value: string) => void; onTab?: () => void }) {
  const filterStateRef = useRef<MouseInputFilterState>(MOUSE_INPUT_FILTER_INITIAL)
  const valueRef = useRef(value)
  const ownValueRef = useRef(value)
  const [cursor, setCursor] = useState(value.length)
  const cursorRef = useRef(cursor)

  useEffect(() => {
    valueRef.current = value
    if (value !== ownValueRef.current) {
      ownValueRef.current = value
      const next = clampToEnd(value)
      cursorRef.current = next.cursor
      setCursor(next.cursor)
    }
  }, [value])

  const commit = (next: CursorState) => {
    valueRef.current = next.text
    ownValueRef.current = next.text
    cursorRef.current = next.cursor
    setCursor(next.cursor)
    onChange(next.text)
  }

  useInput((input, key) => {
    if (isDisabled) return
    if (key.tab) {
      onTab?.()
      return
    }
    if (
      key.return ||
      key.upArrow ||
      key.downArrow ||
      key.tab ||
      key.escape ||
      key.pageUp ||
      key.pageDown
    ) {
      return
    }
    if (key.leftArrow) {
      commit(moveLeft(valueRef.current, cursorRef.current))
      return
    }
    if (key.rightArrow) {
      commit(moveRight(valueRef.current, cursorRef.current))
      return
    }
    if (key.home) {
      commit(moveToHome(valueRef.current, cursorRef.current))
      return
    }
    if (key.end) {
      commit(moveToEnd(valueRef.current, cursorRef.current))
      return
    }
    if (
      (key.ctrl && (input === "w" || input === "\u0017")) ||
      ((key.backspace || key.delete) && (key.ctrl || key.meta))
    ) {
      commit(wordDeleteAt(valueRef.current, cursorRef.current))
      return
    }
    if (key.backspace) {
      commit(backspaceAt(valueRef.current, cursorRef.current))
      return
    }
    if (key.delete) {
      commit(deleteAt(valueRef.current, cursorRef.current))
      return
    }
    if (!input || key.ctrl || key.meta) return
    const result = filterMouseInput(input, filterStateRef.current)
    filterStateRef.current = result.state
    if (result.keptInput.length > 0) {
      commit(insertAt(valueRef.current, cursorRef.current, result.keptInput))
    }
  })

  return <CursorText value={value} cursor={cursor} placeholder={placeholder} disabled={isDisabled} />
}
