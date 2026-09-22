# 0002: Session Storage in the Project Directory

## Status

Accepted

## Context

Sessions were persisted to the user's home directory at `~/.vicode/sessions/<project-hash>/<id>.json`, where `<project-hash>` was an 8-character SHA-256 of the absolute project path. That layout had two problems.

First, it spread per-project state into a global, machine-local location: a project's history existed only on the machine where it was created, and was invisible to anyone (or anything) working from a checkout elsewhere. Second, the hash indirection meant every project needed to re-derive an opaque key just to find its own files, and the `projectPath` collision-rescue is exactly the kind of physical scoping that invites edge cases (renaming a folder orphans its sessions; the hash is unreadable to a human).

The rest of the codebase already embraced the opposite convention: project-level configuration (`system.md`, `.vicode.json`) lives inside `.vicode/` in the project root. The glossary already describes Session storage as `<project>/.vicode/sessions/<id>.json` — the code had simply not caught up.

## Decision

Store all session files inside the project directory at `<project>/.vicode/sessions/<id>.json`.

- `getSessionsDir(projectPath)` now returns `join(projectPath, ".vicode", "sessions")` — the single point where the path was computed.
- `computeProjectHash()` and the `createHash` import are deleted; nothing else referenced them.
- Startup resume, previously dead code (`initialSession` was never assigned), now calls `loadLatestSession(projectPath)`, so the Welcome screen's "Resume Session" flow is reachable.
- The `.vicode/sessions/` directory is git-ignored so a project's history never pollutes its git status.
- Because `saveSession`/`loadSession`/`listSessions` already take an opaque `sessionsDir`, no other call sites changed: the post-Turn auto-save, `/session` list/switch, and `/new` all repoint automatically.

## Considered Options

- **Keep the home-directory layout and drop the hash, keying by project name**: still leaks per-project state into a global location and collides when two projects share a name.
- **Store in the project root as a single flat file**: dirtier than a dedicated subfolder and gives no natural home for future per-project state.
- **Store under `~/.local/share/vicode/` or an OS app-data directory**: matches the "proper" native-app pattern, but viCode is a per-project CLI tool; project-local storage is the more discoverable, git-following convention already used by `.vicode/config` and `.vicode/skills`.

## Consequences

- **Positive**: Session history travels with the project and is readable where the project lives.
- **Positive**: The project-hash indirection and its edge cases (renamed folders, unreadable paths) disappear.
- **Positive**: Tests that use `getSessionsDir(tempDir)` now write into the temp dir instead of the real home directory.
- **Negative**: Sessions are no longer shared across machines unless the project directory itself is.
- **Negative**: A project's `.vicode/sessions` folder grows over time; housekeeping (pruning old sessions) is now the project owner's responsibility rather than a centralised cleanup.