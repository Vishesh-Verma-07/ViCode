import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react"
import type { PickerRequest } from "../core/types"

export interface ChatDrafting {
  inputKey: number
  inputValue: string
  setInputValue: (value: string) => void
  handleInputChange: (value: string) => void
  suggestionDismissed: boolean
  setSuggestionDismissed: (dismissed: boolean) => void
  suggestionHighlight: number
  setSuggestionHighlight: Dispatch<SetStateAction<number>>
  pickerRequest: PickerRequest | null
  openPicker: (request: PickerRequest) => Promise<number | null>
  closePicker: (index: number | null) => void
  resetInput: () => void
}

/**
 * Owns the chat input draft: the buffered text, the command-suggestion
 * highlight, and any modal Picker request raised by a slash command.
 */
export function useChatDrafting(): ChatDrafting {
  const [inputKey, setInputKey] = useState(0)
  const [inputValue, setInputValue] = useState("")
  const [suggestionDismissed, setSuggestionDismissed] = useState(false)
  const [suggestionHighlight, setSuggestionHighlight] = useState(0)
  const [pickerRequest, setPickerRequest] = useState<PickerRequest | null>(null)
  const pickerResolveRef = useRef<((index: number | null) => void) | null>(null)

  const handleInputChange = useCallback((value: string) => {
    setInputValue(value)
    setSuggestionDismissed(false)
    setSuggestionHighlight(0)
  }, [])

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
    setInputValue("")
    setSuggestionDismissed(false)
    setSuggestionHighlight(0)
  }, [])

  return {
    inputKey,
    inputValue,
    setInputValue,
    handleInputChange,
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