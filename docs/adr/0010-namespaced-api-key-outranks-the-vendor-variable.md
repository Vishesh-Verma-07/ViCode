# 0010: The Namespaced API Key Outranks the Vendor's Own Variable

## Status

Accepted

## Context

Spec #77 decision 12 promised three tiers of environment variable for a Provider's API Key and then numbered them ambiguously: "the vendor's own variable name, then a namespaced override, then the existing OpenRouter variable preserved". Read in that order the middle tier can never fire. A namespaced variable that loses to the vendor variable can only ever be consulted when the vendor variable is unset — which is the case where the tier is not needed, because the vendor variable is already the answer. Issue #84 asks for the tier anyway, and its problem statement says why: a user exports `OPENAI_API_KEY` for other tooling and wants ViCode on a different OpenAI account in CI. Under the literal order, unsetting the shared variable stays the only way out.

The same paragraph describes the third tier as "the existing OpenRouter variable preserved", which reads as a fallback every Provider inherits. Taken literally, an `OPENROUTER_API_KEY` in the environment would authenticate the `openai` route — a gateway credential posted to a vendor's endpoint. That does not degrade gracefully into a working fallback; it fails as an auth error with a message pointing at the wrong account.

So the tiers as written are either inert or harmful, and only one ordering both fires and stays honest.

## Decision

The narrower scope wins, and the legacy name stays where it actually belongs.

- **A Provider's credential has two names.** The one native to its own tooling (`OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `OPENROUTER_API_KEY`, `OPENCODE_API_KEY`) and ViCode's own, namespaced `VICODE_` + that name (`VICODE_OPENAI_API_KEY`, and so on).
- **The namespaced name is derived, not declared.** `providerEnvVars()` in `src/core/providers.ts` builds it from the descriptor's `nativeEnv`, so a registry entry cannot declare one name and be consulted on another, and adding a Provider remains one entry. `--help` renders the block from the same call, so the documented order is the real one.
- **Order, highest first: a configured key, then `VICODE_<NATIVE>_API_KEY`, then `<NATIVE>_API_KEY`.** Which config layer a key comes from is Config Layering's business, not this ADR's. The namespaced variable is consulted ahead of the native one because it is the narrower claim: a variable scoped to this tool outranks one scoped to every other program on the machine. The reverse order is not a stricter policy, it is an unreachable tier.
- **The Vendor's own name still stands alone.** A user who exports `ANTHROPIC_API_KEY` for Anthropic's own tooling authenticates ViCode with no second copy and no namespaced variable to remember.
- **The legacy tier is OpenRouter's own Vendor name, not a cross-Provider fallback.** `OPENROUTER_API_KEY` keeps authenticating `openrouter` exactly as before and is never offered to another route. "Preserved" means the pipelines that already set it keep working, not that it becomes a universal last resort.
- **Resolution reads only; it never writes back.** A namespaced variable shadows the vendor one for ViCode and leaves it untouched for every other tool in the same shell.
- **One namespaced name per console.** `VICODE_OPENCODE_API_KEY` authenticates both Zen and Go, because they share one console and one key as before.

## Consequences

- **Positive**: the CI case from issue #84 works — `OPENAI_API_KEY` stays exported for everything else while `VICODE_OPENAI_API_KEY` routes ViCode to its own account.
- **Positive**: the native variable keeps working untouched, so nothing a user already has stops authenticating, and the legacy OpenRouter pipeline needs no edit.
- **Positive**: adding a Provider is still one registry entry; the namespaced tier and the `--help` row come along with the native name.
- **Positive**: `keyForProvider` asks the registry directly instead of `listProviders().find(...) ?? []`, which quietly returned no tiers at all for an id outside the registry — one the `ProviderId` type already excluded.
- **Negative**: a namespaced variable inherited from a project `.env` outranks a native variable exported in the shell, so ViCode can silently authenticate as a different account than the surrounding shell implies. That is the whole point of the tier, and the order is rendered into `--help`, stated in the README, and returned by `providerEnvVars` rather than left to be discovered.
- **Negative**: a user who sets both names to different keys gets the namespaced one with no warning. Reversing the order to warn would reintroduce issue #84, so the documentation carries it instead.
- **Negative**: the descriptor field is `nativeEnv`, one of the tiers, not the resolution order. A consumer reading the raw field sees less than `providerEnvVars` gives it, so the function is the seam and the field alone is not the contract.
- **Negative**: a Provider sitting on a console it shares with another Provider (Zen and Go) collapses to one `--help` row, so the help no longer names one row per Provider the way the Provider list above it does. The row is one key, not two, and the line under it says so.
