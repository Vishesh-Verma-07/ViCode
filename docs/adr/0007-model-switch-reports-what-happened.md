# 0007: A Model Switch Reports What Happened

## Status

Accepted

## Context

`/model` announced every pick as a success. `src/commands/model.ts` called `ctx.models.switchTo(chosen)`, discarded the return, and returned `` `Switched to ${chosen}` `` — but `ModelsCapability.switchTo` was typed `void` (`src/core/types.ts`) while its implementation in `use-agent-session.ts` returned a `boolean` and returned `false` whenever the target Provider held no key. Typing it `void` is what let the command ignore it: there was nothing to branch on.

So the ordinary case was a lie. Someone with an OpenRouter key only, scrolling `/model` to a Claude on Anthropic, read `Switched to anthropic/claude-…`; the Status Bar still named the OpenRouter model, the next Turn was billed to OpenRouter, and nothing anywhere said otherwise. Wrong billing and wrong route are worse than a failure the user can see, and the confirmation is the one line they are guaranteed to read.

`ProvidersCapability.switchTo` had the same disease in a milder form: it returned the model id it landed on, or `null` for *every* failure, so `/provider` could say `Cannot switch to Anthropic.` and never why.

The refusal itself was correct behaviour — refusing to switch a route onto a credential that does not exist. Only the reporting was broken.

## Decision

Give the switch an outcome, and build the confirmation out of the outcome rather than the request.

- **One result type for both capabilities.** `ModelSwitchResult` is `switched { modelId }`, `needs-key { provider }`, or `refused { reason }`, and it is the return type of `ModelsCapability.switchTo` and `ProvidersCapability.switchTo`. `modelId` is read back from the Provider that was just built rather than echoed from the request, so "Switched to X" is a report rather than a hope.
- **`needs-key` and `refused` are different facts.** One is fixed by running `/key`, the other is not fixed by anything the user can type; collapsing them into `null` (or a bare `false`) forces the caller to re-derive the cause from state it does not hold, which is how the bug came back in the first place.
- **One line prints a refusal.** `refusalLine()` in `src/commands/model.ts` renders both failure kinds, and it only accepts a `ModelSwitchResult` that is not `switched` — so the type system, not a convention, is what keeps a refusal out of a success message and `/model` and `/provider` from drifting apart.
- **The switch owns the credential, so it owns the prompt.** `switchTo` in `use-agent-session.ts` is the only code that rebuilds the live Provider; it now also offers the key prompt before refusing, and `providers.switchTo` shrinks to choosing the target Model and delegating. That is where the duplicated `No API key for … Set one with /key …` string went — there were two copies, one per command path.
- **A switch prompts through the optional screen.** `openKeyEntryFor`, not `ensureKeyFor`. The required screen is the pre-chat gate: Cancel is disabled and Esc answers with a warning, so the only way out is Ctrl+C — quitting the app, losing the Session, for a pick the user can simply walk away from. Declining is not an error state: it returns `needs-key`, and the command prints `No API key for Anthropic. Set one with /key anthropic.` with the route untouched.
- **A refusal says what is wrong.** `refused` carries a sentence the user can act on — an id that is not provider-qualified, a Provider offering nothing ViCode can call, a Provider outside the registry — rather than the old `Cannot switch to X.` A Provider that *throws* while being built (an unreachable Model, which the picker already filters out) still surfaces as a command error; that is a malfunction, not an outcome, and it keeps its stack.

## Considered Options

- **Return `boolean`.** Rejected: it answers "did it happen?" and not "what is live now?", so the command would still have to assume the model it asked for is the model serving the next Turn — the exact assumption that made the original bug. It also leaves the caller to guess between "no key" and "cannot build a Provider", which is the difference between running `/key` and giving up.
- **Refuse with a message and never prompt.** Rejected: the user is one key away from the Model they picked, `ProviderOffering.hasKey` already marks it `no key` in the picker rather than hiding it, and `ProvidersCapability` already had the prompt. Refusing outright is the honest floor, not the ceiling.
- **Leave `ProvidersCapability` on `string | null`.** Rejected: two shapes for one operation, and once the prompt moved into the shared switch the wrapper would have had to re-derive the cause anyway — it could no longer ask the switch *why* it failed.
- **Let the Command own the prompt** by calling `ctx.key.set(provider)` and then `switchTo` again. Rejected: it splits one operation across two round trips (and two chances to fail), and the Command layer has no way to know whether a key entered at the screen actually landed — only the host does.
- **Report the refusal as an error** by throwing from `switchTo`. Rejected: nothing failed. The user asked a question, got an answer, and stays in the conversation; `dispatchCommand` renders errors as `Error executing /model: …`, which frames a normal outcome as a malfunction.

## Consequences

- **Positive**: `/model` and `/provider` can no longer claim a route they did not take. The Status Bar, the Session record, the bill and the confirmation line all agree or the command says why they do not.
- **Positive**: one switch implementation owns key resolution, the prompt and the refusal reasons, so a fourth command that wants to move the route does not reimplement any of it.
- **Positive**: `/provider` gets better refusals for free — `Anthropic has no models ViCode can call.` instead of `Cannot switch to Anthropic.`
- **Costs**: both capabilities are now async, and the two command tests that stubbed `switchTo` had to state a result rather than ignore one. That is the seam doing its job — a stub that cannot say what happened cannot be used to prove what is reported.
- **Costs**: a switch onto a keyless Provider interrupts the user with the API Key Entry Screen. That was already true of `/provider`, and it is the price of not lying; the prompt is dismissible, and the picker marks the row `no key` before it is ever picked.
- **`/provider`'s prompt became dismissible.** Its key prompt was the required screen until the prompt moved into the shared switch; it now uses the optional one like `/model`. A user who picks a Provider they hold no key for can walk back out of it instead of being quoted a Ctrl+C.