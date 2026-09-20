import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react"
import type { PickerRequest } from "../core/types"
import { appendInput, createInputHistory, editDraft, historyText, stepDown, stepUp, type InputHistoryState } from "./input-history"

export interface ChatDrafting {
  inputKey: number
  inputValue: string
  setInputValue: (value: string) => void
  handleInputChange: (value: string) => void
  recallUp: () => void
  recallDown: () => void
  submitInput: (text: string) => void
  suggestionDismissed: boolean
  setSuggestionDismissed: (dismissed: boolean) => void
  suggestionHighlight: number
  setSuggestionHighlight: Dispatch<SetStateAction<number>>
  pickerRequest: PickerRequest | null
  openPicker: (request: PickerRequest) => Promise<number | null>
  closePicker: (index: number | null) => void
  resetInput: () => void
}

export function useChatDrafting(): ChatDrafting {
  const [inputKey, setInputKey] = useState(0)
  const [walk, setWalk] = useState<InputHistoryState>(createInputHistory([], ""))
  const [suggestionDismissed, setSuggestionDismissed] = useState(false)
  const [suggestionHighlight, setSuggestionHighlight] = useState(0)
  const [pickerRequest, setPickerRequest] = useState<PickerRequest | null>(null)
  const pickerResolveRef = useRef<((index: number | null) => void) | null>(null)

  const inputValue = historyText(walk)

  const handleInputChange = useCallback((value: string) => {
    setWalk((w) => editDraft(w, value))
    setSuggestionDismissed(false)
    setSuggestionHighlight(0)
  }, [])

  const setInputValue = useCallback((value: string) => {
    setWalk((w) => editDraft(w, value))
  }, [])

  const recallUp = useCallback(() => {
    setWalk((w) => stepUp(w))
  }, [])

  const recallDown = useCallback(() => {
    setWalk((w) => stepDown(w))
  }, [])

  const submitInput = useCallback((text: string) => {
    setWalk((w) => appendInput(w, text))
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
    setSuggestionDismissed(false)
    setSuggestionHighlight(0)
  }, [])

  return {
    inputKey,
    inputValue,
    setInputValue,
    handleInputChange,
    recallUp,
    recallDown,
    submitInput,
    suggestionDismissed,
    setSuggestionDismissed,
    suggestionHighlight,
    setSuggestionHighlight,
    pickerRequest,
    openPicker,
    closePicker,
    resetInput,
  }
}