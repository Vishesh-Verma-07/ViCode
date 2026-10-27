# 0017: A Drag Selects Messages, Not Text

## Status

Accepted. Extends the keyboard-first rule in [ADR-0016](0016-a-tab-is-a-seat-not-a-session.md); it does not overturn it. Release behavior is amended by [ADR-0018](0018-a-resting-mouse-selection-copies-itself.md), which copies a mouse selection once it rests instead of leaving every drag for `Enter`.

## Context

[Select Mode](../../CONTEXT.md) gave the transcript a way to copy messages without the terminal's own drag-select, which mouse tracking had already taken away. It was keyboard-only: `Ctrl+S`, arrows, `Space`, `Enter`. The pointer could switch Tabs but could not choose what to copy.

ADR-0016 rejected motion reporting because it "floods stdin with an event per cell crossed and breaks terminal drag-select". That objection is about **hover** tracking (mode 1003), which reports every pointer move whether or not a button is down. It does not apply to **button-event** tracking (mode 1002), which reports motion only while a button is held. The flood is then bounded by a gesture the user is deliberately making.

The terminal reports a pointer in screen cells, while a message is a block of wrapped rows sized by an estimate. Two consequences follow: the transcript cannot offer character-level selection without a second layout engine, and hit testing has to be told where the panel begins on screen.

## Decision

A pointer gesture chooses **whole messages**.

- **The mouse can enter Select Mode.** A left press on a message opens it with that message highlighted. A press outside the transcript — the usage panel, the input, the status bar — names nothing and does nothing.
- **A drag marks a range.** Press anchors a message, motion marks every copyable message between the anchor and the pointer, and release keeps the marks. Releasing does not copy; `Enter` still does, so a drag can be corrected before it becomes a clipboard write. Dragging back to the anchor clears the range, which is what a plain click should mean.
- **The wheel moves the highlight while selecting.** It does not scroll, because the auto-scroll that keeps the highlight visible would immediately undo the scroll. Outside Select Mode the wheel scrolls as before.
- **Tracking stays at 1002, never 1003.** There is no hover, no pointer cursor and no per-cell feedback. The only new input is the motion the terminal sends while a button is held.
- **Hit testing reuses the transcript's own line estimate.** Blocks already carry the rows they occupy and, for a message, its id. The caller supplies the panel's 1-based screen row so the Tab Bar and any notice above it are counted; the mapping otherwise shares the geometry that scrolling already trusts.
- **A press and its first motion may arrive in one chunk.** The drag path reads the anchor from a ref rather than from rendered state, so a coalesced gesture cannot lose its first cell.

The clipboard route is unchanged: a native command where one exists, OSC 52 otherwise.

## Consequences

- **Positive**: the gesture people try first — click, then drag across a reply — now works, and it lands on the same marks `Space` would have made.
- **Positive**: because the unit is a message, the mapping is exact at block boundaries and does not depend on wrapped-character positions, diff rows or code-fence widths.
- **Positive**: no hover events, so pointer movement over the window still costs nothing.
- **Negative**: selecting half a message remains impossible; the user who wants one sentence must copy the whole message and trim it. Correcting that needs a character-level layout model, not a larger hit-test.
- **Negative**: the panel now depends on its screen row. A new row of chrome above the transcript must be added to `screenTop`, or clicks will name the message above the one under the pointer.
- **Negative**: terminals that ignore 1002 (or the SGR `1006` encoding) will see no drag at all. The keyboard path remains complete, which is why it stays the primary one.
