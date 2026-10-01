# 0004: Naming Sessions

## Status

Accepted

## Context

A Session's only human identifier is its `id` — `sess_<epochMs>_<6-char-base36>`, generated in `createSession()` (`src/core/session.ts`). That id is what `/session` showed in its picker, what `/new` reported when it saved the outgoing Session, and what `/session` echoed after a switch. A project accumulates one of these per conversation, and after a few days of work the list is a wall of near-identical timestamps. There was no way to tell "the conversation where I was porting the parser" from "the one where I chased the flaky test" except by opening each one.

The constraint is that a Session is rewritten wholesale after **every** turn: `use-agent-session.ts` builds the next `Session` by spreading the in-memory one and calling `saveSession`. Anything a command writes to disk alone is therefore clobbered by the next auto-save. A name that only exists on disk is a name that does not exist.

## Decision

Give a Session an optional `name`, and add a `/rename` command that sets it on the **active** Session.

- **Stored, not derived.** `Session` gains `name?: string`, written into the same `<project>/.vicode/sessions/<id>.json` record as everything else. `renameSession()` in `src/core/session.ts` is the single transform: it returns a copy with the name set, or with the key deleted when the name is `null` (or empty, so the function and `readName()` agree on what "no name" means).
- **The host owns persistence.** `SessionsCapability` gains `rename(name: string | null): void`, implemented in `use-agent-session.ts` next to the `switchTo` that replaces the live `Session`. It saves to disk *and* updates in-memory state in one step, which is the only way the name survives the next turn's auto-save. The command interprets arguments and reports; it never touches the filesystem. (`/session` and `/new` persist from the command layer because they only ever *replace or add* a record — `/rename` is the first command to mutate a field of the live one.)
- **Inline arguments, no prompt.** `/rename My Session` joins the words that follow the command. No new text-entry surface, no new UI state, and it keeps working under the streaming guard's existing "commands are ignored while responding" rule.
- **Cosmetic.** Renaming leaves `updatedAt` alone, so it never reorders the `/session` picker's most-recent-first list, and it changes nothing about the messages, model, Mode, or totals.
- **Capped at 60 characters, and rejected rather than truncated.** `MAX_SESSION_NAME_LENGTH` lives in core beside `Session`. A silent truncation would store a name the user never typed and make the picker disagree with the file; an explicit message keeps the stored fact equal to the requested one.
- **Clearing is an argument, not a second command.** `clear` (with `remove` and `delete` as aliases, matching `/key remove`) is recognised **only as the sole argument**, so `/rename delete the parser` names a Session "delete the parser" instead of silently wiping an existing name. The cost is that `clear`, `remove` and `delete` cannot be a Session's name on their own — the same trade-off `/key` already makes.
- **No Session, no rename.** A Session record does not exist until a first message is sent, so `/rename` reports that and asks for a message rather than creating an empty, named, zero-message record in the picker.
- **One place decides what a Session is called.** `formatSessionName()` in `src/commands/session.ts` returns `name (id)` when named and the bare `id` when not; the picker labels, the post-switch confirmation line, and the rename confirmation all read from it, so the id stays visible even for a named Session.
- **The `/session` picker is where `/rename` is advertised.** `PickerRequest` gains an optional `hint`, rendered as a muted line under the items, and `/session` fills it with the `/rename` syntax. Naming a Session is only ever wanted at the moment you are scanning a list of ids to find one — the exact moment the command is invisible. An unprompted `/rename` is a guess about which of twenty conversations will matter later, which is unanswerable at startup. The hint is generic to the Picker, so `/model` and `/skill` can carry one too.
- **The Command Suggestion is where `/rename`'s *syntax* is taught.** `Command` gains an optional `usage`, and `findUsageHint()` returns it once the name has been typed in full and no argument has been started. A description says what a command does; only the usage line says that a name has to *follow* it, and the suggestion dropdown is the only surface open at that moment. The hint disappears the moment the user types a space — they have it, and a stale line under the dropdown they are trying to read past is noise.

## Considered Options

- **An interactive text prompt** for the name, as `/key` uses. Rejected: it needs a new entry surface, new state, and a new capability, for a value the user can already type on the same line. Inline arguments also mean `/rename` works identically from a pasted transcript.
- **A picker over saved Sessions** so any Session could be renamed, not just the current one. Rejected for now: it doubles the interaction (pick, then type) for the common case, and a second command can add non-active renaming later without changing the storage.
- **Truncating over-long names to 60 characters.** Rejected: silent data loss, and the picker would show something the user never typed.
- **A separate `clearName()` capability** alongside `rename(name)`. Rejected: two methods for one operation invites a caller to reach for the wrong one; `null` reads unambiguously as "no name", and `renameSession()` already treats `""` the same way.
- **Bumping `updatedAt` on rename** so a renamed Session floats to the top. Rejected: renaming is not activity, and reordering the list as a side effect of naming makes the list jump under the user.

## Consequences

- **Positive**: `/session` becomes scannable — names lead, ids stay for disambiguation, and unnamed Sessions are unchanged.
- **Positive**: the name survives every save path for free, because every save spreads the same in-memory `Session`.
- **Positive**: spreading `PickerRequest` into `<Picker>` and `CommandSuggestionProps` into `<CommandSuggestion>` means a new field on either reaches every render site without a second edit. Both surfaces previously forwarded their props field by field, and a new field passed its own unit tests while being silently dropped in the running app — twice, for two different surfaces.
- **Positive**: `Session` stays a flat record with no sidecar file, matching ADR-0002's "one JSON file per Session" and ADR-0003's `lastCompaction?` precedent.
- **Negative**: only the Session you are in can be named. Renaming a Session from the picker is still unbuilt.
- **Negative**: `clear`, `remove` and `delete` are reserved as bare arguments and cannot be a Session's name.
- **Negative**: `readName()` treats any non-string stored value as no name, so a hand-edited `name` in a session file is silently discarded on load rather than surfaced as an error.
