# 0003: Context Compaction

## Status

Accepted

## Context

Long sessions outgrow the model's context window. Before this change, ViCode's only defence was Truncation: `project()` (in `src/core/project-context.ts`) silently drops the oldest messages that no longer fit the budget and trims oversized Tool Results, inserting a truncation marker so the model knows something is missing. Truncation is lossy in a specific, painful way — whole turns vanish and the model has only a sentinel telling it the text existed. `SPEC.md` had explicitly listed summarization as out of scope ("No summarization or truncation of old messages… the LLM will hit its context limit naturally").

The Usage Panel already painted a warning at 60% of the context window ("Context" row), but that number is **cumulative token spend** since the session began, not the live in-window size — so it could not drive any real decision. The honest meter already existed in code: `estimateMessageTokens()` measures the actual message array.

The change: a `/compact` command plus automatic compaction inside the Agent Loop, both built on one shared core, folding old history into a model-written running summary so work continues instead of hitting the wall.

## Decision

Add **Compaction**: summarize the older part of the conversation into a single ever-growing **Running Summary** message, keeping the current turn verbatim, and let both the Agent Loop (automatically) and `/compact` (manually) trigger it.

- **One core, two triggers.** `compactHistory()` in `src/core/compaction.ts` is the single implementation. The loop calls it at the top of each iteration, before `project()`, when the honest meter crosses the threshold; the `/compact` command calls it unconditionally through a new `ctx.compaction.compact()` capability.
- **Rolling window.** Only messages *before the last `user` turn* are folded; that turn and its Tool Results stay verbatim. Summarizing mid-loop must never amputate the turn the agent is actively working on.
- **Running Summary not fresh summaries.** Compaction appends the new summary block to the previous one (`existingSummary + "\n\n" + text`) instead of re-summarizing the summary, so repeated compactions never compound memory loss.
- **Carrier.** A new `ContextSummaryContent` block (`{ type: "context-summary", summary, foldedMessages, foldedTokens, at }`) on a `user`-role message, discriminated from `Text`/`ToolCall`/`ToolResult`. `convertMessages` maps it to a marked user text part; the Chat Panel renders it as a distinct "Context compacted — N messages folded" card.
- **Honest meter.** Auto-compaction fires when `estimateMessageTokens(messages) / contextLength ≥ COMPACT_THRESHOLD_RATIO` (0.6), checked once per loop iteration. The 60% figure matches the Usage Panel's warning colour but is now an in-window measure, not cumulative spend.
- **Summary generation.** A new optional `Provider.summarize(transcript, summaryPrompt, abortSignal)` performs a non-streamed completion with a fixed bullet contract (`Goals · Decisions · Files touched · Changes made · Open threads`). Its `TokenUsage` accrues into the turn/session totals like any paid call. Providers without `summarize` are treated as compaction-incapable and simply skip auto-compaction.
- **Bounded audit trail.** `Session` gains `lastCompaction?: { before: Message[], summary, at }`, overwritten on each compact — one snapshot, no sidecar files, reversible enough for forensics if a path or decision is ever needed verbatim.
- **Non-blocking, transparent.** Auto-compaction never pauses the loop; while the summarizer runs the Status Bar shows `{ kind: "compacting" }` and the resulting card is the permanent in-transcript record.

## Considered Options

- **Full-replace compaction** (manual `/compact` folds *everything*, leaving only the summary). Rejected: the categorical answer focused on the loop, and a manual compact mid-thought should not flatten the context the user is still pointing at. One rule for both paths is also far less surprising.
- **Rewrite the running summary each time** instead of appending. Rejected: recompression compounds loss every time it runs; appending preserves the first summarization verbatim.
- **Carry the summary as a system-prompt layer.** Rejected: the system prompt is a static string rebuilt per turn and is not persisted with the Session; the summary must travel inside the message array to survive saves and reconnects.
- **Trigger from cumulative `usage.totalTokens`.** Rejected: that figure is session-spend, not in-window size; compaction would fire while the window is half empty (or never fire in a single-turn marathon).
- **Cheaper dedicated summarizer model.** Deferred: a config knob, not part of v1. The current model is reused.

## Consequences

- **Positive**: sessions survive past their context limit; the honest meter means auto-compaction coincides with real pressure on the window.
- **Positive**: the 60% / 80% colour nudges in the Usage Panel now coincide with an actual behaviour at 60%.
- **Positive**: `Provider` stays a minimal seam — `summarize` is optional, so third-party mocks and providers that never compact don't pay for a method they don't use.
- **Negative**: compaction is a paid model call on a large input; the cost shows up in honest totals.
- **Negative**: the summary is lossy by design — exact tool output older than the current turn survives only in the `lastCompaction` snapshot.
- **Negative**: this reverses the earlier "no summarization" position in `SPEC.md`; that line was already overtaken by `project()`'s truncation, and compaction at least preserves meaning rather than deleting it.