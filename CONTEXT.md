# ViCode Context

ViCode is a terminal AI-coding agent (TUI, built with Ink) that runs a manual ReAct loop against an LLM Provider, with tools, sessions, config, and an API key gate standing between the user and the model.

## Language

### Agent

**Agent Loop**:
The core ReAct cycle: send messages to the LLM → receive a response → parse Tool Calls → execute Tools → feed results back → repeat until no more Tool Calls.
_Avoid_: ReAct Loop (use Agent Loop), generation

**Turn**:
One user message plus the agent's complete response cycle — reasoning, Tool Calls, and Tool Results — until it stops and yields the floor.
_Avoid_: exchange, conversation round

**Tool Call**:
An invocation of a Tool by the LLM, consisting of the Tool name and its arguments. Approval attaches to individual Tool Calls, not whole Tools.
_Avoid_: tool use, function call

**Tool**:
A function the LLM can invoke to interact with the filesystem or shell. Each Tool has a name, description, Zod parameter schema, and execute function.

**Approval Rule**:
The rule deciding whether a Tool Call pauses for user approval: a call pauses iff it is a `bash` call that is not a Silent Bash Call, or a file operation whose target is a Sensitive Path or lies outside the Project Root. Approval attaches to individual Tool Calls, not whole Tools. Approving a resolved path also auto-approves later calls to that same path for the rest of the Turn, so each distinct path surfaces at most one explicit approval per Turn.

**Bash Allowlist**:
The user-configured set of first command tokens (configured via the `silentBashCommands` setting, merged across config layers) whose bash Tool Calls may run as Silent Bash Calls.
_Avoid_: whitelist, allow list

**Silent Bash Call**:
A bash Tool Call that executes without pausing for user approval because its first command token is on the Bash Allowlist, no command token resolves to a Sensitive Path, and its resolved working directory stays inside the Project Root and is not a Sensitive Path.
_Avoid_: silent command, approval-free bash

### Model access

**Provider**:
An LLM backend (e.g., OpenRouter) that the agent sends messages to and receives responses from, abstracted behind a `Provider` interface.

**API Key**:
The credential that authenticates the user to the Provider. Stored as the `apiKey` field of the Global Config. It is a credential, not a configuration choice, so it lives in the global config file rather than the project config.
_Avoid_: token (ambiguity with LLM token budget), secret key

**API Key Entry Screen**:
The focused full-overlay surface that prompts the user for an API Key when one is missing. It has two modes: required (must be satisfied before the user can chat, Cancel disabled) and optional (dismissible, opened via `/key`). Saving the key runs the current Session's pending request and the provider is recreated with the fresh key.
_Avoid_: key screen, key modal, credential prompt

**Global Config**:
The `~/.vicode/config.json` file. Config Layering gives it priority below Project Config. It is the only place an API Key is written.
_Avoid_: settings file, config file (unqualified)

**Config Layering**:
Configuration priority: project config (.vicode.json) > global config (~/.vicode/config.json). Runtime changes (model, skills) happen via Commands, not CLI flags.

### Conversation persistence

**Session**:
A saved conversation between the user and the agent, stored as JSON at `<project>/.vicode/sessions/<id>.json` — one file per Session. Scoping is physical: a Session lives inside the directory it belongs to, so a project only ever surfaces its own sessions.
_Avoid_: chat (the view), history

**New Chat**:
The Welcome Screen action that begins a fresh conversation. Identical in behaviour to the `/new` command: the current Session (if any) is saved, then messages, usage, unit counters and active Skills are cleared and the chat view opens empty.
_Avoid_: new session, clear chat

**Input History**:
The in-memory, session-scoped list of every Input the user submits (Messages and Commands alike), recalled into the Input Box draft by Up/Down arrows. Cleared by New Chat. Recalling is drafting, not replaying: a recalled Input is a fresh message on submit, not a re-run of the old turn.
_Avoid_: message history (implies the transcript), command history

**Compaction**:
Replacing the older part of the conversation history with a model-generated summary once the window grows too large, so the agent keeps working instead of hitting the context limit. Distinct from Truncation, which silently drops or trims messages that exceed the budget.
_Avoid_: summarization, context pruning, compacting the window

**Running Summary**:
The single ever-growing message at the front of the history that accumulates everything earlier conversation has been Compacted down to, so repeated compactions never compound memory loss. New summaries append to it rather than replacing it.
_Avoid_: summary message, accumulated summary

**Compact Threshold**:
The Context Load percentage at which auto-compaction fires within the Agent Loop — 60% of the context window by default. The `/compact` Command is unconditional and ignores the threshold.
_Avoid_: compact limit, context alarm

**Context Load**:
The current estimated size of the message history — the estimated tokens of every message in the array — expressed as a percentage of the model's context window. The honest meter behind the Compact Threshold. Distinct from the Usage Panel's percentage, which reflects cumulative token spend since the session began, not the live in-window size.
_Avoid_: context usage, context-window usage (overlaps the cumulative panel figure)

### Prompting

**System Prompt**:
Instructions sent to the LLM at the start of the conversation defining its behaviour, available Tools, and constraints. Layered: base + project + user.

**Skill**:
A markdown instruction file whose full content is injected as a System Prompt layer when activated via `/skill`, shaping agent behaviour until the session ends. Discovered from project `.vicode/skills/` and global `~/.vicode/skills/`; project wins on name collision. Multiple active Skills stack.

**Mode**:
A session-level behaviour context selecting which Tools are exposed to the model and adding a hardcoded System Prompt layer. Three built-in Modes (build, discuss, plan) are cycled with Tab; the switch renders immediately but applies from the next user input. Distinct from View (home/chat), Skill (a user-toggled prompt layer that persists across Modes), and Turn Status.
_Avoid_: posture, role (both imply the whole assistant identity)

### Control surface

**Command**:
A user-invoked application action typed as a slash command (e.g., `/new`, `/model`) in the chat input. Distinct from a Tool, which is invoked by the LLM. An input is treated as a Command attempt only if its first word starts with `/`.
_Avoid_: slash command, command

**Command Suggestion**:
The dropdown rendered above the chat input listing matching Commands as the user types after `/`. Shows a "no commands match" state when nothing matches.
_Avoid_: autocomplete, suggestion dropdown

**Doom Loop**:
When the LLM repeatedly calls the same Tool with the same arguments, indicating it is stuck. Detected and terminated automatically.
_Avoid_: loop, infinite loop

**Streaming**:
Token-by-token delivery of the LLM response, rendered in real-time in the UI.

**Approval Prompt**:
The overlay shown while a Tool Call awaits user consent, displaying the Tool name and arguments and accepting `y`/`n`.

### Filesystem

**Sensitive Path**:
A file path protected from unsupervised access — matched by default patterns (`.env*`, key material, credential stores, `.ssh/**`) plus user-configured patterns. Reads, writes, and edits pause for approval (reads too, not just writes and edits); search results omit matches inside them.

**Project Root**:
The allowed boundary for file operations — the directory a Session lives in. Operations inside it on normal project files run silently; operations outside it require approval and proceed once approved.

### Layout & rendering

**TUI**:
Terminal User Interface. A text-based UI rendered in the terminal using Ink (React for CLIs).

**Surface**:
A region of the TUI separated from its neighbours by a background shade rather than a border line. The window chrome — Chat Panel, Usage Panel, Status Bar — is laid out as surfaces layered on the App Background, each a shade of grey up the ramp; floating overlays keep borders.

**App Background**:
The color painted behind the entire TUI — applied via a background token on the root container, filling every panel and overlay. Any gaps between Surfaces show App Background.

**Input Box**:
The text-entry region rendered as a borderless box with a raised background shade (`inputShade`), distinct from surrounding surfaces purely by its lighter background. The active Mode is indicated inside it as a colored left-edge bar plus a Mode Tag, rendered from the Design Token palette; the rest of its styling (background shade, cursor) is untouched. Covers both the Welcome Screen's first-message box and the Chat window's full-width input strip.

**Mode Tag**:
The colored `[Build]`-style label plus left-edge bar rendered inside an Input Box from the Mode's Design Token color (build blue, discuss purple, plan orange), marking the active Mode. Updating it on a Tab cycle is immediate and never interrupts a running Turn. Distinct from an Inline Chip, which marks inline code inside prose.

**Cursor**:
The movable insertion position inside an Input Box draft, rendered as a block (an inverse space) between the text halves. Moved one grapheme cluster at a time by Left/Right arrow keys, or jumped to the start/end with Home/End. Every edit operation acts at it rather than at the string end.
_Avoid_: caret, insertion mark, cursor block

**Cursor-Aware Editing**:
The Input Box editing model where typing, backspace, delete, word-delete (Ctrl+W / Ctrl+Backspace), and Home/End all apply at the Cursor rather than the end of the draft. Draft replacement from outside the component (recalling Input History, `/new`) snaps the Cursor to the end.
_Avoid_: positional editing, in-place editing

**Design Token**:
A named value in the central palette (`COLORS`, `ICONS`) that all UI styling references, so visual language stays consistent instead of using scattered hardcoded colours.

**Code Block**:
A framed region — border plus a dark background shade lighter than the App Background — used to render fenced model output and executed command output.

**Inline Chip**:
A short code snippet inside prose (single-backtick `` `cmd` ``) rendered with a dark background and no border, so it reads as embedded code without a full frame.

**Command Line**:
The first line inside a Tool-Result Code Block — `$ npm run dev` — painted in the primary color to show which command was executed.

**Sidebar**:
The right panel of the two-panel layout, showing Tool Call logs and file diffs in tabbed view.

**Status Bar**:
Bottom bar showing model name, token count, and estimated cost.

**Turn Status**:
The Status Bar's live indication of agent activity: idle, thinking, running a Tool, waiting for approval, done (with elapsed time), or errored.
_Avoid_: status, activity state

**Usage Panel**:
The right-hand TUI panel showing the active model, context-window usage, running token totals, cost, and turn count.

**Welcome Screen**:
The "home" view shown at startup (and returned to via `/home`): banner, model info, the New Chat / Resume Session menu, and the first-message input. Keyboard-first — mouse clicks are treated as input noise, never as selections.