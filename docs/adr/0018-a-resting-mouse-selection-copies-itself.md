# 0018: A Resting Mouse Selection Copies Itself

## Status

Accepted. Amends the release rule in [ADR-0017](0017-a-drag-selects-messages-not-text.md).

## Context

ADR-0017 made the mouse choose whole messages but kept copying behind `Enter`, so a drag only produced marks. That protected a range from becoming a clipboard write before it could be corrected, but it also left the mouse gesture unfinished: the user selected with the pointer and then had to move to the keyboard to do the thing they had already asked for.

The gap between "I have chosen these messages" and "copy them" is visible in the interaction. A pointer that has stopped moving is no longer being aimed; a keyboard that is still being touched is. ViCode can tell those apart because it already receives drag and release events, and every key passes through the Tab Host before the transcript.

## Decision

A mouse selection that has stopped moving for **700 ms** copies itself.

- **Only the mouse starts the countdown.** The gesture counter rises on drag motion and on release, and resets to zero on a press. `Ctrl+S`, an arrow, `Space`, `Esc`, `Enter`, or a wheel notch sets it back to zero, so a keyboard adjustment cancels the pending copy instead of letting it fire against the range as it was.
- **A rejected press cannot arm a copy.** Release only starts the countdown when the press named a copyable message. Clicking a tool result, a Feedback Line, or chrome does not schedule a copy of whatever was selected before.
- **The receipt is the confirmation.** A successful mouse copy replaces the transcript for 2.4 seconds with a small centered popup: the count, the first five lines of the copied text cut to the popup's width, and `Press any key to dismiss`. The input is disabled while it is up, so a key aimed at the popup cannot land in the draft behind it; any key dismisses it. A keyboard copy keeps its existing Feedback Line and does not raise the popup.
- **`Enter` still works.** It copies immediately, and `Esc` still leaves without copying. The pause is an accelerator, not the only route.
- **A failed copy keeps the selection open.** The countdown fires once; if the clipboard refuses the write, the error appears in the transcript and the user can retry with `Enter`. The selection is not silently lost.

## Consequences

- **Positive**: click-or-drag followed by a pause is now a complete copy gesture. The pointer no longer hands off to the keyboard for the common case.
- **Positive**: the receipt answers "what did I just copy?" in the window rather than in a one-line notice that can scroll away.
- **Negative**: a user who clicks a message to enter Select Mode and then hesitates for 700 ms gets a copy they did not ask for. The pause is the whole signal, and any key or wheel notch before it cancels; a longer delay would make the gesture feel unresponsive.
- **Negative**: the popup is modal for one keystroke. That is deliberate — it covers the input — but it means the first key after a mouse copy dismisses rather than types.
- **Negative**: the copy happens on a timer, so tests and future surfaces must be able to say when a gesture settled. The exported `AUTO_COPY_PAUSE_MS` is that seam.
