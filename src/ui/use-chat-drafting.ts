import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react"
import type { PickerRequest } from "../core/types"
import { appendInput, createInputHistory, editDraft, historyText, stepDown, stepUp, type InputHistoryState } from "./input-history"

export interface ChatDrafting {
  inputKey: number
  inputValue: string
  /** Where the Cursor sits in `inputValue`, so the draft knows which mention is active. */
  inputCursor: number
  setInputValue: (value: string) => void
  handleInputChange: (value: string, cursor: number) => void
  /** Replaces `[start, end)` of the draft; the Cursor lands at the end of the result. */
  replaceDraftRange: (start: number, end: number, text: string) => void
  recallUp: () => void
  recallDown: () => void
  submitInput: (text: string) => void
  suggestionDismissed: boolean
  setSuggestionDismissed: (dismissed: boolean) => void
  suggestionHighlight: number
  setSuggestionHighlight: Dispatch<SetStateAction<number>>
  fileMentionDismissed: boolean
  setFileMentionDismissed: (dismissed: boolean) => void
  fileMentionHighlight: number
  setFileMentionHighlight: Dispatch<SetStateAction<number>>
  pickerRequest: PickerRequest | null
  openPicker: (request: PickerRequest) => Promise<number | null>
  closePicker: (index: number | null) => void
  resetInput: () => void
  resetHistory: () => void
}

export function useChatDrafting(): ChatDrafting {
  const [inputKey, setInputKey] = useState(0)
  const [walk, setWalk] = useState<InputHistoryState>(createInputHistory([], ""))
  const [inputCursor, setInputCursor] = useState(0)
  const [suggestionDismissed, setSuggestionDismissed] = useState(false)
  const [suggestionHighlight, setSuggestionHighlight] = useState(0)
  const [fileMentionDismissed, setFileMentionDismissed] = useState(false)
  const [fileMentionHighlight, setFileMentionHighlight] = useState(0)
  const [pickerRequest, setPickerRequest] = useState<PickerRequest | null>(null)
  const pickerResolveRef = useRef<((index: number | null) => void) | null>(null)

  const inputValue = historyText(walk)

  const handleInputChange = useCallback((value: string, cursor: number) => {
    setWalk((w) => editDraft(w, value))
    setInputCursor(cursor)
    setSuggestionDismissed(false)
    setSuggestionHighlight(0)
    setFileMentionDismissed(false)
    setFileMentionHighlight(0)
  }, [])

  const setInputValue = useCallback((value: string) => {
    setWalk((w) => editDraft(w, value))
    setInputCursor(value.length)
  }, [])

  /**
   * Applies a replacement the Input Box did not make and points the Cursor at
   * the end of the result — the same place the Input Box clamps to when it
   * receives a draft it did not type. Both halves move together so the mention
   * under the Cursor and the Cursor the user sees cannot disagree.
   */
  const applyExternalDraft = useCallback((next: InputHistoryState) => {
    setWalk(next)
    setInputCursor(historyText(next).length)
  }, [])

  const replaceDraftRange = useCallback(
    (start: number, end: number, text: string) => {
      const current = historyText(walk)
      applyExternalDraft(editDraft(walk, current.slice(0, start) + text + current.slice(end)))
      setFileMentionDismissed(false)
      setFileMentionHighlight(0)
    },
    [walk, applyExternalDraft],
  )

  const recallUp = useCallback(() => {
    applyExternalDraft(stepUp(walk))
  }, [walk, applyExternalDraft])

  const recallDown = useCallback(() => {
    applyExternalDraft(stepDown(walk))
  }, [walk, applyExternalDraft])

  const submitInput = useCallback((text: string) => {
    setWalk((w) => appendInput(w, text))
    setInputCursor(0)
  }, [])

  useEffect(() => {
    if (historyText(walk).trimStart().startsWith("/")) {
      setSuggestionDismissed(false)
    }
  }, [walk])

  const openPicker = useCallback((request: PickerRequest) => {
    return new Promise<number | null>((resolve) => {
      pickerResolveRef.current = resolve
      setPickerRequest(request)
    })
  }, [])

  const closePicker = useCallback((index: number | null) => {
    pickerResolveRef.current?.(index)
    pickerResolveRef.current = null
    setPickerRequest(null)
  }, [])

  useEffect(() => {
    return () => {
      pickerResolveRef.current?.(null)
      pickerResolveRef.current = null
    }
  }, [])

  const resetInput = useCallback(() => {
    setInputKey((prev) => prev + 1)
    setWalk((w) => ({ ...w, pointer: null, draft: "" }))
    setInputCursor(0)
    setSuggestionDismissed(false)
    setSuggestionHighlight(0)
    setFileMentionDismissed(false)
    setFileMentionHighlight(0)
  }, [])

  const resetHistory = useCallback(() => {
    setInputKey((prev) => prev + 1)
    setWalk(() => createInputHistory([], ""))
    setInputCursor(0)
    setSuggestionDismissed(false)
    setSuggestionHighlight(0)
    setFileMentionDismissed(false)
    setFileMentionHighlight(0)
  }, [])

  return {
    inputKey,
    inputValue,
    inputCursor,
    setInputValue,
    handleInputChange,
    replaceDraftRange,
    recallUp,
    recallDown,
    submitInput,
    suggestionDismissed,
    setSuggestionDismissed,
    suggestionHighlight,
    setSuggestionHighlight,
    fileMentionDismissed,
    setFileMentionDismissed,
    fileMentionHighlight,
    setFileMentionHighlight,
    pickerRequest,
    openPicker,
    closePicker,
    resetInput,
    resetHistory,
  }
}