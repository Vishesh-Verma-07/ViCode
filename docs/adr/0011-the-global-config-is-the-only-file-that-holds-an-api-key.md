# 0011: The Global Config Is the Only File That Holds an API Key

## Status

Accepted

## Context

CONTEXT.md and GLOSSARY.md both said a Project Config never carries an API Key — a key is a credential, not a configuration choice. ADR-0010 deferred the question of *which* layer a configured key comes from to Config Layering, and Config Layering never answered it.

The code answered it the other way. `collectKeys(globalConfig, projectConfig)` read both layers, so a project key overrode a global one for the same Provider and a project config could add a key for a Provider the global one never mentioned. `--help` then listed `.vicode.json` second under "Set your API keys in one of", with a worked example — so the documented rule and the taught rule were opposites, and the taught one was the one a new user would follow.

A credential in `.vicode.json` is a leaked one. That file is meant to be committed; it travels with the repository, into every clone and every CI job that checks the project out. The stated reasoning for keeping the credential map out of the project layer was that a key is not a configuration choice, and a combined record invites putting one there — and then the code invited it and the help taught it.

The two directions were both workable, so this needed deciding rather than defaulting. Ignoring a project key silently was the tempting middle: no crash, no data loss, the key simply unused. But a user whose key was accepted yesterday would find a Provider with no key and no explanation, and would reasonably conclude their key was wrong rather than misplaced.

## Decision

The Global Config holds keys, and a Project Config has no key fields at all.

- **One layer holds credentials.** `collectKeys` in `src/config/config.ts` takes the Global Config alone. There is no merge, and no project half to win, so "prefer global over project" is not the rule — project keys do not exist as a setting.
- **The Project Config schema refuses them by name.** `projectConfigSchema` shares the six non-key fields with `globalConfigSchema` and adds none of its own. Both are strict, so an `apiKey` or `apiKeys` in `.vicode.json` is a parse failure that names the field. This is a refusal rather than an ignore, because the user has to be told which file to move it out of — and refusing is a stronger signal than a key that quietly stops working.
- **A refused config says which file and which field, and says all of it.** `ConfigError` carries the path and the unrecognised fields, and `refusesApiKey` distinguishes a key from any other unknown field, so startup advice about keys is not printed for a typo in `modelFrmatVersion` or for a malformed `~/.vicode/config.json`. Every issue is reported, each naming the field it is about — a file with an unknown key *and* a mistyped one is fixed in one pass rather than one run at a time. The error names the file and fields rather than dumping zod's issue array over a TUI that never opened.
- **A refusal stops startup, as a strict schema already did.** Every other malformed read in this codebase degrades — an unparseable session loads as absent, an unreachable catalog leaves prices unknown — but the config schema has always been strict, and a config the user wrote by hand should fail loudly rather than start on a silently reduced configuration. `/key` is not suggested in that message: it lives in the TUI that did not open.
- **`--help` names the two places a key may live** — the global config, or the environment — and states that a project `.vicode.json` refuses one. The README's example is split into one file per layer, and the key table gained a Scope column.

## Consequences

- **Positive**: code, `--help`, the README, CONTEXT.md and GLOSSARY.md now say the same thing, so the taught rule is the documented one and there is no second reading of where a key goes.
- **Positive**: a key in `.vicode.json` is reported by name at startup rather than read, so a user who followed the old help learns which field to move before they push a credential.
- **Positive**: `collectKeys` no longer takes a variable argument list, which read as a merge waiting to happen. The single argument states the rule in the signature.
- **Negative**: a `.vicode.json` carrying a key that was valid until now refuses to start ViCode, and a user must edit it before anything runs. That is the cost of the refusal, and the alternative — silently not using a key the user is looking at — is the failure mode that has no message at all. Anyone affected has the key in a file they should not commit anyway, so the exposure is one they need to fix regardless.
- **Negative**: the two schemas must stay in step on the six shared fields, so adding a setting means editing `configLayerFields` once and both schemas follow. A setting added to only one would be silently unavailable in that layer, which the strict schema then reports — so the failure is visible, not silent.
- **Negative**: key resolution is now asymmetric with every other setting. Model, System Prompt, Sensitive Paths and the Bash Allowlist all layer; keys do not, and a reader arriving from any of the other four has to learn the exception. It is recorded in the Config Layering entry rather than left to be discovered.