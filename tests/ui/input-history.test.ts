import { describe, expect, it } from "bun:test"
import { createInputHistory, editDraft, historyText, stepDown, stepUp } from "@/ui/input-history"

const HIST = ["oldest", "middle", "newest"]

describe("input history walk core", () => {
  describe("createInputHistory", () => {
    it("starts at the draft slot with the preserved draft on top", () => {
      expect(historyText(createInputHistory(HIST, "wip"))).toBe("wip")
    })

    it("starts at the draft slot with an empty draft for a fresh input", () => {
      expect(historyText(createInputHistory(HIST, ""))).toBe("")
    })
  })

  describe("stepUp", () => {
    it("recalls the most recent Input first from the draft slot", () => {
      expect(historyText(stepUp(createInputHistory(HIST, "wip")))).toBe("newest")
    })

    it("moves exactly one Input older per step", () => {
      const first = stepUp(createInputHistory(HIST, "wip"))
      expect(historyText(first)).toBe("newest")
      expect(historyText(stepUp(first))).toBe("middle")
    })

    it("walks toward the oldest and clamps there without wrapping", () => {
      let state = createInputHistory(HIST, "wip")
      state = stepUp(state)
      state = stepUp(state)
      state = stepUp(state)
      expect(historyText(state)).toBe("oldest")
      expect(stepUp(state)).toBe(state)
      expect(historyText(stepUp(state))).toBe("oldest")
    })

    it("is a clamped no-op on empty history", () => {
      const state = createInputHistory([], "wip")
      expect(stepUp(state)).toBe(state)
      expect(historyText(stepUp(state))).toBe("wip")
    })

    it("is a clamped no-op on single-entry history already at the entry", () => {
      const recalled = stepUp(createInputHistory(["only"], "wip"))
      expect(historyText(recalled)).toBe("only")
      expect(stepUp(recalled)).toBe(recalled)
    })
  })

  describe("stepDown", () => {
    it("steps toward the newer Inputs from a recalled position", () => {
      let state = createInputHistory(HIST, "wip")
      state = stepUp(state)
      state = stepUp(state)
      expect(historyText(state)).toBe("middle")
      expect(historyText(stepDown(state))).toBe("newest")
    })

    it("returns to the preserved unsent draft past the newest entry", () => {
      let state = createInputHistory(HIST, "wip")
      state = stepUp(state)
      state = stepUp(state)
      state = stepUp(state)
      state = stepDown(state)
      state = stepDown(state)
      expect(historyText(state)).toBe("newest")
      expect(historyText(stepDown(state))).toBe("wip")
    })

    it("clamps below the draft slot", () => {
      const draft = stepDown(stepUp(createInputHistory(HIST, "wip")))
      expect(historyText(draft)).toBe("wip")
      expect(stepDown(draft)).toBe(draft)
      expect(historyText(stepDown(draft))).toBe("wip")
    })

    it("is a clamped no-op on empty history", () => {
      const state = createInputHistory([], "wip")
      expect(stepDown(state)).toBe(state)
      expect(historyText(stepDown(state))).toBe("wip")
    })

    it("returns to the draft from a single-entry history and clamps there", () => {
      const draft = stepDown(stepUp(createInputHistory(["only"], "wip")))
      expect(historyText(draft)).toBe("wip")
      expect(stepDown(draft)).toBe(draft)
    })
  })

  describe("editDraft", () => {
    it("detaches the walk so the edited text becomes the new draft", () => {
      let state = createInputHistory(HIST, "wip")
      state = stepUp(state)
      state = stepUp(state)
      expect(historyText(editDraft(state, "middle edited"))).toBe("middle edited")
    })

    it("subsequent steps leave the edited draft behind", () => {
      let state = createInputHistory(HIST, "wip")
      state = stepUp(state)
      state = stepUp(state)
      state = editDraft(state, "middle edited")
      expect(historyText(stepUp(state))).toBe("newest")
      expect(historyText(stepDown(state))).toBe("middle edited")
    })

    it("does not mutate the stored Input still in history", () => {
      let state = createInputHistory(HIST, "wip")
      state = stepUp(state)
      state = stepUp(state)
      editDraft(state, "middle edited")
      expect(HIST).toEqual(["oldest", "middle", "newest"])
    })
  })

  describe("round trip", () => {
    it("an Up-then-Down round trip restores exactly what was drafted", () => {
      const start = createInputHistory(HIST, "unsent draft text")
      expect(stepDown(stepUp(start))).toEqual(start)
    })
  })

  describe("purity", () => {
    it("step and edit functions never mutate the input state or its history", () => {
      const state = createInputHistory(HIST, "wip")
      const snapshot = { ...state, history: [...state.history] }
      stepUp(state)
      stepDown(state)
      editDraft(state, "x")
      expect(state).toEqual(snapshot)
      expect(state.history).toEqual(HIST)
    })
  })
})