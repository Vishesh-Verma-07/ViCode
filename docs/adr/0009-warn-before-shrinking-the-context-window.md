# 0009: Warn Before Shrinking the Context Window

## Status

Accepted

## Context

`/model` annotates each row with price and key state but never `contextLength`, so a 32k Model and a 200k one look alike at the moment of choosing. `switchTo` performed no context comparison at all, so picking the 32k one from a 200k session rewrote the Provider and said nothing more than `Switched to openrouter/narrow-beta`.

The next turn then does one of two things, neither of them visible. Compaction fires at 60% of the new window and folds everything before the last user turn into a summary. Or, if the Provider cannot summarise, `project()` drops whatever no longer fits the budget. Either way history the user wrote is gone, and the confirmation line reads exactly as it would if the smaller Model had simply not needed it.

This is the failure ADR 0008 was written about, one layer up. There, an unmeasured window rendered as `$0.00`, a confident number about a Model nobody had priced. Here the window *is* measured — the Model Catalog has it — and the truncation is still silent, which is the same dishonesty with an extra step: the tool dropped the history and the user cannot tell that from the Model not wanting it.

## Decision

State the shortfall and let the user rule on it, rather than deciding for them or saying nothing.

- **`/model` rows carry the context window.** `formatContextWindow` renders the Catalog's figure, or `— ctx` when the Catalog publishes none. A row the user cannot size is a row they pick blind, and an Unknown window stays a dash: no assumed default anywhere, per ADR 0008.
- **`contextShortfall()` is the measurement, `describeContextShortfall()` the sentence.** Pure and in `src/core/`, so the arithmetic is testable without a React tree and the wording is testable without a terminal. It returns null — no warning at all — when the target's window is Unknown or the conversation already fits the budget. Warning on every switch trains the answer to be `y`, which is the same as not warning.
- **The warning names figures, not a verdict.** The load as a percentage of the target's window, the budget that window leaves the Agent Loop, and that history will be compacted or truncated. It deliberately names *no end* of the history: Compaction folds the oldest, while `project()` keeps the oldest prefix and drops what follows, so an end could only ever be right about one of the two. ADR 0003 describes `project()` as dropping the oldest; the code keeps it, and this warning is written to be true either way.
- **The switch asks, and confirming still switches.** `switchTo` gains a `confirmContextSwitch` seam, alongside the key prompt ADR 0007 gave it, and the answer is `y`/`n` or `Esc`. `y` performs the switch — the warning informs the choice, it does not replace it, and a long session survives the switch to be compacted on the smaller window. `n` refuses with `refused`, the shape ADR 0007 defined for a refusal the user can act on, and the route is untouched.
- **The switch owns its prompts, so the warning comes before the key.** Both prompts live in `switchTo`; asking for the credential first would mean demanding a secret on the way to a switch the user is about to decline. The cost is that `/provider` onto a narrow, keyless Provider warns before it can report `needs-key`.
- **No seam means no switch, not no warning.** `confirmContextSwitch` is optional, so a host that cannot ask would otherwise truncate in silence — precisely what this ADR exists to stop. With no seam to ask through, the switch refuses and says why. Every other precondition in `switchTo` is unconditional for the same reason.

## Considered Options

- **Refuse to switch onto a smaller window outright.** Rejected: a smaller window with a short conversation is a fine choice, and refusing it makes `/model` unusable for anyone who works in bursts. The user is the only one who knows whether losing the earlier turns is acceptable for the work in front of them.
- **Switch silently, as before.** Rejected: this is the bug.
- **Auto-compact before switching.** Rejected: it spends a real summarisation call on the current Model to paper over a decision the user has not made yet, and it produces a summary they never asked for. It also fails exactly where it is needed — a Provider with no `summarize` cannot compact at all, which is the case that silently truncated in the first place.
- **Warn but switch without asking.** Rejected: a warning the user cannot act on is a log line, and the only action available would be to undo the switch. Asking is the whole of the value.
- **Move the comparison into the Command.** Rejected for the reason ADR 0007 rejected the mirror image: the Command holds no messages and no live Provider, so it would have to re-derive the load from state it does not hold. The switch is the only place both sides of the comparison are known — the live conversation and a resolvable target window.
- **Let the Command own the prompt**, as it could by calling `ctx.models.switchTo` and then asking on failure. Rejected: it splits one operation across two round trips, and it reports a switch that already happened as a switch the user prevented.

## Consequences

- **Positive**: the choice and the consequence are on the same screen. The row says how much room the Model has; the warning says how much of the conversation will not fit it.
- **Positive**: `/provider` gets the warning for free, because `providers.switchTo` delegates to the shared `switchTo` — the same mechanism ADR 0007 put the key prompt behind.
- **Positive**: the budget arithmetic now has one home. `contextBudgetFor()` derives it from a bare window so a Model can be measured before it is live, and `contextBudget()` is that function applied to the live Provider.
- **Costs**: a second blocking prompt in the App, with its own state, input branch and render site alongside the key screen and the tool-approval prompt. A user who declines is asked about the conversation, not only about the route.
- **Costs**: the warning triggers on an estimate. `estimateMessageTokens()` divides bytes by four, so the figure it reports is honest about being an estimate and may be off. That is the same estimate the Compact Threshold is built on, and being wrong in the warning direction only costs an unnecessary confirmation.
- **Costs**: the mismatch this exposes is not fixed by it. `project()` keeps the oldest prefix and drops the newest, which contradicts ADR 0003 and is worse than dropping the oldest. Fixing that is a separate change to the Agent Loop; recording it here is not.
