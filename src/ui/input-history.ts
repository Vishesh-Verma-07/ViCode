export interface InputHistoryState {
  history: readonly string[]
  pointer: number | null
  draft: string
}

export function createInputHistory(history: readonly string[], draft: string): InputHistoryState {
  return { history, pointer: null, draft }
}

export function stepUp(state: InputHistoryState): InputHistoryState {
  if (state.pointer === null) {
    if (state.history.length === 0) return state
    return { ...state, pointer: state.history.length - 1 }
  }
  if (state.pointer > 0) return { ...state, pointer: state.pointer - 1 }
  return state
}

export function stepDown(state: InputHistoryState): InputHistoryState {
  if (state.pointer === null) return state
  if (state.pointer < state.history.length - 1) return { ...state, pointer: state.pointer + 1 }
  return { ...state, pointer: null }
}

export function editDraft(state: InputHistoryState, text: string): InputHistoryState {
  return { ...state, pointer: null, draft: text }
}

export function appendInput(state: InputHistoryState, text: string): InputHistoryState {
  return { history: [...state.history, text], pointer: null, draft: "" }
}

export function historyText(state: InputHistoryState): string {
  if (state.pointer === null) return state.draft
  return state.history[state.pointer] ?? state.draft
}