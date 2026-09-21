# 0001: Cursor-Aware, Grapheme-Wise Input Editing

## Status

Accepted

## Context

Input Boxes (the Chat input strip and the Welcome Screen first-message box) used to be append-only: every key inserted at the end, backspace trimmed the tail, and the block cursor was a static marker rendered after the text. Ink gives us no real terminal cursor to position, so we introduced a Cursor that lives in local component state and moved all editing onto pure functions `(text, cursor) → (text, cursor)` in `src/ui/cursor-edit.ts`. Left/Right, Home/End, typing, backspace, delete, and Ctrl+W all act at the Cursor instead of the string end.

## Decision

Movement counts one grapheme cluster as one step (`Intl.Segmenter`), not one UTF-16 code unit, so astral plane and ZWJ emoji like `👨‍👩‍👧` move and delete as a single unit instead of breaking apart. A shared presentational `CursorText` component renders the icon, the draft, and the block Cursor between its two halves; both surfaces reuse the edit functions and the strip. An incoming `value` that did not come from the component's own edit (Input History recall, `/new`, a submitted send) snaps the Cursor to the end.

## Considered Options

- **Wrap the whole terminal in raw-readline editing**: readline gives battle-tested line editing, but its cursor control fights Ink's declarative renderer and would have forced a rewrite of how every input in the TUI is drawn.
- **Code-point (Array.from) movement**: simpler than grapheme clusters, but still splits ZWJ-family emoji and combining marks, which read as visibly broken in a chat box where emoji are common.
- **Single shared edit engine instead of two surfaces calling the same pure functions**: central state would push Cursor bookkeeping through `useChatDrafting` and app.tsx; keeping the Cursor local to each input component while sharing only the pure functions keeps the controlled `value` contract untouched.

## Consequences

- **Positive**: Moving, inserting, backspacing, deleting, and word-deleting now behave the way terminals users expect anywhere in the draft.
- **Positive**: The edit logic is pure and unit-testable independent of Ink.
- **Positive**: Emoji and other multi-code-unit text navigate and delete intact.
- **Negative**: Two surfaces each own a Cursor offset, so they must stay in sync with the draft contract (`value` in, `onChange` out) — future surfaces must follow the same pattern or the duplication grows.
- **Negative**: `Intl.Segmenter` is not available on every platform; `splitGraphemes` falls back to code points (the grapheme guarantees degrade gracefully).