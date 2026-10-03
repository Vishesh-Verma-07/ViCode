# 0008: Unknown is not zero

## Status

Accepted

## Context

ADR 0005 made models.dev the Model Catalog and stated that when the catalog has no entry for a Model, "we degrade to zero cost and unknown context length — never to a crash." Only the second half survived into the code. `getModelInfo().contextLength` did become `undefined`, but it was consumed as `contextLength ?? FALLBACK_CONTEXT_LENGTH` — a hardcoded 200k — so an unmeasured window became a specific false claim about how much history fits. Cost never degraded at all: `calculateCost` took a `ModelPricing | null` and a `null` priced out to `$0.00`.

The result is the worst of both readings. A session on an uncatalogued Model reported spending nothing while spending money, and reported a context load percentage against a window nobody had measured. Both numbers were confident and both were wrong.

The root cause is a type that could not say "I don't know." `TokenUsage.cost` was `number` and `ModelInfo.contextLength` was `number | undefined`. Widening them to admit unknown values forces the question at every call site instead of letting a default answer it silently — which is the only place the answer can be got wrong.

Issue #79 reports the symptom from the field: a gateway Model absent from the catalog shows `$0.00`.

## Decision

**Unknown is a value, not a missing field.**

- `TokenUsage.cost` and `Session.totalCost` are `number | null`. `null` means the Model Catalog cannot price the Model.
- `ModelInfo.contextLength` and `ModelListing.contextLength` are `number | null`. `null` means the window is unmeasured. `FALLBACK_CONTEXT_LENGTH` is deleted; there is no assumed window anywhere.
- The Model Catalog carries pricing as `ModelPricing | null` on a `CatalogModel`, surfaced to pickers as an explicit `{ kind: "unknown" }` listing variant. Pricing is Unknown unless both the input and output rates parse — a rate that is absent, malformed, or non-finite makes the Model's price Unknown. A rate that parses to exactly zero stays a genuine zero, because a free Model is free.
- Unknown prices sort last in `/model`, after free and paid Models alike.
- `formatCost(null)` and an Unknown context render as `—`, in a muted style distinct from the measured values around them. A Usage Panel cost of `—` is styled as unknown, not as a real total.
- The Usage Panel's `Context` row is always present. An Unknown window shows `—`; the row is not hidden and not defaulted.
- `addCost` is the only way totals grow. Unknown is absorbing: once any Turn in a Session is unpriced the Session total is Unknown for the rest of it, because a sum with one missing term has no honest value.
- An Unknown context window means no percentage and therefore no threshold: history is sent unprojected and threshold-driven compaction does not fire. `/compact` remains unconditional.
- `ZERO_USAGE` — the stand-in for a completion whose usage never arrived — is Unknown-cost, not zero-cost. Zero tokens is the only honest zero available; the price of a call nobody reported is not.
- Persisted sessions normalise `totalCost` on load: a stored number survives, anything else becomes `null`. A fresh Session starts at `0`, so an untouched Session costs nothing.
- When a Provider must land on a default Model, it prefers paid, then free, then Unknown. Starting a Provider on "we have no idea what this costs" is nobody's idea of a default.
- A single missing, malformed, or non-finite rate makes the Model's price Unknown. We do not price half a Model.

## Consequences

- **Positive**: no figure in the UI is asserted without a source. `—` means unmeasured, `$0.00` means measured and free, and the two are never confused.
- **Positive**: a Session on an unpriced Model now shows tokens counted and cost unknown, which is the true state and is actionable — fetch a catalog.
- **Positive**: deleting `FALLBACK_CONTEXT_LENGTH` removes a class of bug rather than fixing an instance of it. Any future window-dependent behaviour must handle `null` or not exist.
- **Positive**: cache files written by older builds are upgraded at the load boundary, so widening a persisted field is not a breaking change.
- **Negative**: Unknown costs are absorbing, so one unpriced Turn makes a whole Session's total read `—`. This is deliberate — a partial sum would be a number we cannot stand behind — but it means the cost column goes blank for mixed sessions rather than reporting the priced subset.
- **Negative**: an Unknown context window disables automatic compaction. A Model missing from the catalog can exceed its true window in a long Session and find out from the provider's error rather than from a meter. This is the same trade as deleting the fallback, and `/compact` is still one keystroke away.
- **Negative**: the surface area of `number | null` touches every consumer of usage and context, including third-party-shaped code that will keep wanting a `number`.
- **Negative**: `ModelListing` pricing is now a discriminated union with an `unknown` member, so exhaustive consumers must handle a case that carries no information.