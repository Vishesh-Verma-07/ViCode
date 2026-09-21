# ADR-003: Bash Allowlist Approval Decision

## Status

Accepted

## Context

Every `bash` Tool Call historically paused for user approval, on every invocation. The always-ask rule was the safe default for a Tool that can run arbitrary shell commands, but it also created friction for safe, repetitive, read-only commands such as `ls`, `node`, `echo`, `cat`, `find`, and `npm run <x>` — each interrupting the user for consent on every Turn.

ADR-002 showed that a blanket gate can be relaxed without surrendering consent: file access moved from hard refusal to approval-gated access, with approval kept attached to individual Tool Calls. That decision deliberately left the bash rule untouched ("every `bash` call continues to require approval"). This decision relaxes exactly that remaining line, without reopening the file-path gating ADR-002 set down.

## Decision

A `bash` Tool Call pauses for user approval unless **all three** of these hold:

1. The command's first token is on the Bash Allowlist (the `silentBashCommands` setting).
2. No resolved command token matches a Sensitive Path.
3. The resolved working directory stays inside the Project Root and is not itself a Sensitive Path.

When all three hold, the call runs as a **Silent Bash Call** — it executes without pausing for user approval.

Calls that do not qualify still ask on every call; there is no turn-memory for bash approvals, unlike the approved-path memory that applies to file operations under ADR-002. An empty Bash Allowlist means every `bash` call asks, preserving the pre-feature always-ask default. A rejected call still feeds the rejection message back to the Agent Loop unchanged, so the model sees exactly why its call did not run.

**Relationship to ADR-002.** This decision extends the ADR-002 relaxation philosophy to commands without reopening file gating. ADR-002 governs *paths* — which file operations may run once approved. This ADR governs *commands* — which `bash` Tool Calls may run silently. Both keep approval attached to individual Tool Calls, and both make the unconfigured case the safe default.

## Consequences

- **Positive**: Safe, repetitive, read-only commands — `ls`, `node`, `echo`, `cat`, `find`, `npm run <x>` — no longer interrupt the user for consent on every invocation.
- **Negative**: An allowlisted token executes without consent even in a destructive context; the guard is one token's breadth wide, so it is checked against Sensitive Paths on every call, not once at config time. The accepted trade-off is that allowlisted commands such as `npm run <x>` and `git config --global …` execute silently.
- **Mitigation**: The System Prompt documents the rule so the model self-explains and prefers read-only commands before destructive ones, and the sensitive-token and working-directory checks run on every individual call.
