# ADR-002: Approval-Gated Access Beyond the Project Root

## Status

Accepted

## Context

The security boundary for file tools has historically been the project directory, enforced as a hard refusal. `write_file` and `edit_file` blocked any path outside the project root outright, `read_file` refused to touch sensitive paths (`.env`, keys, credential stores) entirely, and `bash` was the only surface with an approval prompt.

Hard refusal is too blunt for a coding agent. The model legitimately needs to read files beyond the project root — sibling projects, workspace configuration, global dotfiles — and blocking them forces the user to copy content by hand. Sensitive reads were impossible even when the user was willing to consent. The goal is not to keep everything inside the boundary, but to ensure nothing crosses it without explicit, per-call consent.

## Decision

Replace hard refusal with **approval-gated access**. A file operation pauses for user approval if its target is a Sensitive Path or lies outside the Project Root; every `bash` call continues to require approval. The operation runs once the user approves.

Approving a resolved path also auto-approves later calls to that same path for the rest of the Turn, so cooperating on one file does not prompt the user again for every follow-up read/write/edit.

## Consequences

- **Positive**: The agent can work with files beyond the project root when the user consents, instead of failing hard.
- **Positive**: Reads, writes, and edits now follow one consistent rule — sensitive paths of every kind pause for approval (reads too, not just writes and edits).
- **Positive**: Every out-of-root or sensitive call still surfaces an explicit approval, so consent is never skipped by accident.
- **Positive**: Turn-scoped approved-path memory avoids repeated prompts for the same file during a single turn.
- **Negative**: Ask-vs-refuse on reads lets approved sensitive content into the model context, where it could be echoed in later output. This is a real trade-off — the user stays in control of what crosses the boundary, but the model gains access the previous model never had.
- **Negative**: Approval is a per-call negotiation, adding a step to every out-of-root or sensitive operation. Turn-scoped memory mitigates repeats within a turn but not across turns.
- **Mitigation**: The system prompt documents the rule so the model explains itself before acting, and search continues to omit sensitive matches even though file tools may read them when approved.