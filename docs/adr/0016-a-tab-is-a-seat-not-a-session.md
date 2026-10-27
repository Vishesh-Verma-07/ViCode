# 0016: A Tab Is a Seat, Not a Session

## Status

Accepted. Amends the Session rule in [ADR-0002](0002-session-storage-in-project-directory.md) and the Session-scoped approval memory in [ADR-0015](0015-fewer-approval-prompts-without-losing-consent.md). Amends the New Chat definition in `CONTEXT.md`. Extended by [ADR-0017](0017-a-drag-selects-messages-not-text.md), which reports motion while a button is held but still refuses hover.

## Context

Until now the TUI has held exactly one conversation. `useAgentSession` owns the messages, the stream, the abort controller, the pending approval and the usage counters as state inside `App`, and `/session` does not run sessions side by side — it replaces the live one. Asking for browser-style tabs is therefore not a rendering change; it is a change to who owns a conversation.

Two constraints from the existing design shape the answer, and neither is negotiable in a terminal:

- **The obvious tab affordances do not exist.** There is no hover, no pointer, and no per-cell motion event. Mouse tracking is enabled for button presses only, and those presses are already discarded as noise — the TUI is keyboard-first. "The close icon appears when you hover the tab" has no faithful implementation; the only way to approximate it is to turn on motion reporting, which floods stdin with an event per cell crossed and breaks terminal drag-select.
- **Both convenient keys are taken.** `Tab` cycles the Mode, and `Ctrl+W` is word-delete inside the Input Box.

A third constraint is a fact about the domain rather than the terminal: a Session record does not come into being until a first message is sent, and a Session is a file on disk that outlives any one run.

## Decision

A Tab is a **seat** in the window, not a conversation. It opens empty and unnamed, binds to a Session on the first message sent in it, and a Session outlives the Tab that held it. Closing a Tab is never deleting a Session.

- **Tabs are not persisted.** The open set lives in memory. `/session` remains the resume path, and no new file is written to say which Tabs were open. Restoring a Tab set would mean inventing a second store whose only job is to rebuild state the Session files already hold.
- **Several Tabs are live at once.** Each Tab owns its own hook instance — its own stream, `AbortController`, pending approval, draft, cursor, input history, Mode, scroll offset and usage. Hidden Tabs keep working; a Turn does not pause because you looked away. The alternative — one live conversation with the others swapped in and out — was rejected because a long Turn would freeze every other Tab, making the new button slower than the app it was added to.
- **Approval memory moves from a module singleton into the Tab.** `approved-paths.ts` is currently one process-wide store cleared once at mount, so with parallel Tabs approving `.env` in one would silently approve it in another. ADR-0015 promises that memory is Session-scoped; per-Tab storage is how that promise survives.
- **The close control is keyboard-first.** `×` renders on the **active** Tab only, which is the closest honest equivalent of hover on a keyboard-driven surface: moving attention to a Tab is what reveals its close control. `Ctrl+T` opens a Tab, `Ctrl+←`/`Ctrl+→` move between them, `Ctrl+1..9` jump, `Ctrl+X` closes the active one. No binding is placed on `Tab`, `Ctrl+W`, or any bare arrow.
- **A background Tab that needs approval badges rather than steals.** It carries `⚠` and a Feedback Line names it; the app does not switch Tabs under the user mid-sentence. An approval is a question, and questions do not move the furniture.
- **Commands bend around the Tab, not the other way round.** `/new` opens a Tab — that is now what the words mean — instead of clearing the current conversation in place. `/session` focuses the Tab already holding the picked Session and otherwise opens a new one. `/rename` remains the single source of a Tab's title. `/home` parks the Tabs behind the Welcome Screen. The exit summary aggregates every open Tab, because that is what the bill was.
- **The side panels speak for the active Tab.** Route, context, tokens, cost and Turn Status stay per-Tab; a window total in the Usage Panel would make per-Tab spend unreadable.
- **The Tab Bar is one row of chrome above both panels,** with no background shade of its own. It is absent on the Welcome Screen, which stays the pre-Tab place.

## Consequences

- **Positive**: a slow Turn is no longer a reason to stop working. Starting a second line of enquiry while the first is still running is the entire point of the feature, and it now costs one keystroke.
- **Positive**: "a Tab is a seat" keeps the two existing concepts intact — New Chat still begins a fresh conversation, and a Session still exists only once something has been said in it. Neither had to be redefined to make room for Tabs.
- **Positive**: closing a Tab is a cheap, reversible act. Nothing is deleted, so the destructive act (deleting a Session) stays where it already was, behind `/session` and its own confirmation.
- **Negative**: parallel Tabs mean parallel spend. Two running Turns bill at once, and the Status Bar only shows the active one — a background Tab can accumulate cost the user is not looking at. The `⚠` badge covers consent but there is no per-Tab cost badge.
- **Negative**: the refactor is real. `App` stops calling `useAgentSession` and renders one host component per Tab, hidden ones returning `null` so their hooks stay mounted and their state survives. Drafting state moves down with it, and every `useInput` handler needs an `isActive` gate, or a hidden Tab will answer keys meant for the visible one.
- **Negative**: `×` appearing only on the active Tab is less discoverable than an always-visible close box, and a user who expects a browser will look for hover. The keyboard hint is the mitigation, not a fix.
- **Negative**: at around six Tabs the strip must shrink and then scroll, so the size of the Tab set stops being visible at a glance — and the Tabs that scroll away are exactly the ones that might be streaming.
