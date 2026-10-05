# 0006: Provider-Qualified Model Ids

## Status

Accepted

## Context

`Session.model` is a bare string (`src/core/types.ts:138`), and `ModelsCapability.switchTo(modelId: string)` (`src/core/types.ts:100`) takes a bare string. That was unambiguous with one provider, where every id is an OpenRouter id.

It stops being unambiguous as soon as more than one provider exists. `claude-opus-5-5` is served by both `anthropic` and `opencode` (Zen) at the same headline price; OpenRouter additionally resells Claude under its own `anthropic/claude-…` namespace. A bare model id therefore no longer identifies which credential authenticates the call, which base URL receives it, or which bill pays for it — all three of which differ per route.

Storing a structured `{ providerId, modelId }` pair would be the type-honest alternative, but it changes the shape of every persisted session file and of `.vicode.json`, neither of which the codebase can do without a migration path it does not currently have.

## Decision

Every model is identified by a single `provider/model` string, split on the **first** `/` only.

- The provider id is one of the known registry ids: `openrouter`, `openai`, `anthropic`, `opencode`, `opencode-go`.
- The model id is whatever the provider itself calls it, kept verbatim and un-namespaced: `anthropic/claude-opus-5-5`, `opencode/claude-opus-5-5`, `openrouter/nvidia/nemotron-3-ultra-550b-a55b:free`.
- Splitting on the first separator is what makes the last example work. OpenRouter ids contain slashes of their own, so a last-separator split would read `nvidia` as the provider.
- `Session.model` and the config `model` field keep their type as `string`. No session file changes shape.
- **Migration is version-gated, not prefix-gated.** A stored value is only rewritten when its container predates this format. Both sessions and `.vicode.json` carry a `modelFormatVersion` field on any write made from here on; `QUALIFIED_MODEL_FORMAT_VERSION` is `2`. A container at the current version is read literally — a leading `openai/` or `anthropic/` there means that Provider. A container without the marker is pre-qualification, so its id is an OpenRouter id by definition and becomes `openrouter/<id>`.
- **The marker is read under both names it has been written as.** It shipped as `version` and is written as `modelFormatVersion`, which is the name this ADR gave it from the start; `version` said nothing about *what* it versioned, inside a record that will one day carry a version of something else. Renaming the field without reading the old one would have called every session and config the current release wrote unmarked, and the fallback rewrites their id onto OpenRouter — the exact misreading the marker exists to prevent. Both names are therefore read and renamed together in `model-id.ts`, and the config schema keeps `version` so the file still parses; a container carrying the old name with the *current* value reads as current-format, and is renamed on its next write. A stale `version: 1` is renamed too, and stays legacy, because the rename says nothing about the value. A session is renamed on its next save; the global config when a key is added or removed. A project `.vicode.json` has no writer, so it keeps the old name for as long as it lives and stays readable throughout.
- **Renaming the config's marker is not the same as stamping it.** The global config is written when a key changes, which is not a Model migration, so it renames a marker that is already there and writes none where there is none. A config with no marker predates qualification and its id is an OpenRouter id; stamping it would claim otherwise. A session is different — every write rebuilds the record through `upgradeSession`, which stamps the current format because a session's id is rewritten there on the same save.

The marker is what makes the rewrite safe. Guessing from the prefix alone cannot work: `anthropic/claude-opus-5-5` is a valid OpenRouter id *and* a valid Anthropic route, and the same string means different credentials on each. Data written before this ADR existed could only ever have been OpenRouter, which is exactly what the marker records.

## Considered Options

- **Structured `{ providerId, modelId }` on Session and config.** Honest types and no parsing ambiguity, at the cost of a breaking change to every saved session file and to `.vicode.json`. Worth revisiting if ids ever need to carry more than a route — but strings keep the picker, the command layer, and the transcript free of a wrapper type today.
- **Keep bare ids and disambiguate by the active provider.** Matches how OpenCode's own config file works, but a session saved on Zen and resumed against Anthropic would silently load a same-named model from a different bill, or fail with no explanation of what changed.
- **Vendor-prefix the id** (`claude-opus-5-5@anthropic`). Solves the collision, but breaks the OpenRouter ids that every existing session already stores, so migration is still required — while also being harder to read than a slash.

## Consequences

- **Positive**: one string carries the route, the credential, and the model, so it can be logged, stored, and passed through unchanged.
- **Positive**: the form reads like the OpenRouter ids the codebase already stores, so the shape is familiar rather than novel.
- **Positive**: legacy sessions keep loading, with an explicit and auditable rewrite rule rather than a guess.
- **Negative**: parsing is string manipulation with a real sharp edge (OpenRouter's embedded slashes). It needs one implementation and tests, not ad-hoc splitting at each call site.
- **Negative**: the rewrite rule is invisible to anyone reading a saved session file — a session that always said `nvidia/nemotron-…` now says `openrouter/nvidia/nemotron-…`. This ADR is the reason that is not mistaken for corruption.
- **Negative**: `Session.model` values become non-portable in one respect: an id naming a provider that is later removed from the registry stops resolving. The registry is the single point of truth for which prefixes are valid, so removing a provider is also a decision about which stored ids stay readable.
- **Negative**: a container written by the current code but carrying a *legacy* id would be stamped as current and left alone, so the two states can drift. Every session write stamps the marker, and the config write does not stamp precisely because it cannot know the id is current, so this needs a bad hand-edit to occur.
- **Negative**: `modelFormatVersion` is a second field to keep in step at every persistence site. Sessions and config are the only two, and both are covered by migration tests.
- **Negative**: the marker is readable under two names for one format's lifetime, so a stale `version` cannot be told from a deliberate one by name alone — only by value. The config schema keeps `version` rather than dropping it because the schema is strict and would otherwise refuse to parse every config the previous release wrote.