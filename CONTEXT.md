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
A function the LLM can invoke: to interact with the filesystem or the shell, or to ask a network service a question. Each Tool has a name, description, Zod parameter schema, and execute function. Read-only means nothing changes on disk — `web_search` leaves the machine and is read-only all the same, which is why every Mode offers it.

**Approval Rule**:
The rule deciding whether a Tool Call pauses for user approval: a call pauses iff it is a `bash` call that is not a Silent Bash Call, a file operation whose target is a Sensitive Path or lies outside the Project Root, or a `web_fetch` call whose URL has not been approved during the current Turn — that third case is the Outbound Fetch Approval Rule, and it is not a path rule under another name. Approval attaches to individual Tool Calls, not whole Tools. Approving a resolved path also auto-approves later calls to that same path for the rest of the Turn, so each distinct path surfaces at most one explicit approval per Turn, and an approved URL carries for the rest of the Turn the same way; `bash` has no memory at all.

**Outbound Fetch Approval Rule**:
The case of the Approval Rule that governs an outbound fetch: a `web_fetch` Tool Call pauses for the user, showing the URL, before any request is issued, unless that exact URL has already been approved during the current Turn. It sits alongside the Sensitive Path and outside-the-Project-Root rules and is not one of them — those two ask because a read or a write reaches material already on disk, this one asks because a request to an arbitrary host leaves the machine on the model's say-so, and a local read inside the Project Root and a request to a host the user never named are not the same kind of act. Approval attaches to the exact URL, never to the host, so approving one URL on a site approves nothing else on it, and a multi-page investigation asks once per URL rather than once per call. The Tool is not `dangerous` — it writes nothing — so the pause is carried by this Approval Rule rather than by the dangerous mark; a URL that is not `http` or `https` is refused without a request being issued, so it is refused rather than approved. The decision, and the two credential decisions beside it, are written down in ADR-0013.
_Avoid_: host approval (approval is per URL, never per host), URL allowlist (it is a per-Turn memory, not a configured list), fetch permission

**Bash Allowlist**:
The user-configured set of first command tokens (configured via the `silentBashCommands` setting, merged across config layers) whose bash Tool Calls may run as Silent Bash Calls.
_Avoid_: whitelist, allow list

**Silent Bash Call**:
A bash Tool Call that executes without pausing for user approval because its first command token is on the Bash Allowlist, no command token resolves to a Sensitive Path, and its resolved working directory stays inside the Project Root and is not a Sensitive Path.
_Avoid_: silent command, approval-free bash

### Model access

**Provider**:
A credentialed route to an LLM backend that the agent sends messages to and receives responses from — a base URL, an API Key, and a set of Models. Five exist: `openrouter`, `openai`, `anthropic`, `opencode` (Zen), `opencode-go` (Go). One Model is reachable through more than one Provider, so a Model alone never identifies the route.
_Avoid_: backend, vendor, engine (a Provider is a route you pay through, not a company)

**Provider kind**:
Whether a Provider is a **vendor** (`openai`, `anthropic` — first-party, billed by its maker) or a **gateway** (`openrouter`, `opencode`, `opencode-go` — resells other Vendors' Models and adds its own margin). This is why the same Model can cost different amounts through different Providers.
_Avoid_: tier, plan type

**Model Vendor**:
The company that trains a Model. Independent of any Provider: Anthropic is the Model Vendor for `claude-opus-5-5` whether it is reached through `anthropic` or through `opencode`.
_Avoid_: provider (the two are not interchangeable), lab

**Model**:
A specific language model as offered by a Provider, identified by a `provider/model` id. A Model has a context window and a price, both read from the Model Catalog. Either may be Unknown, and Unknown is a value in its own right — never a zero, never an assumed default.
_Avoid_: checkpoint, model name

**Model Catalog**:
The catalogue of Models, prices, and context windows fetched from models.dev and cached locally. It is the only source of pricing and context length; when it has no entry for a Model, or when an entry carries a rate that does not parse, both read as Unknown and the app renders that rather than inventing a number.
_Avoid_: model list (collides with the per-Provider listing the picker shows)

**Model Switch**:
The change of the live Model, and with it of Provider, that `/model` and `/provider` ask for. It either happens — reported with the Model now live, so the Status Bar, the Session record and the confirmation agree — or it is refused, and the refusal names its cause: a Provider holding no API Key, a request ViCode cannot act on, or a Context Shortfall the user was warned about and declined. The confirmation is built from the outcome, never from the request, so it cannot outrun the state change. A Context Shortfall is warned about before the switch rather than after: the warning informs the choice instead of replacing it, so confirming still switches and the long Session survives it, to be compacted on the smaller window.
_Avoid_: model change, route switch (a switch is refused as often as it happens)

**API Key**:
The credential that authenticates the user to one Provider. Each Provider holds its own, so the Global Config holds a map of them. It is a credential, not a configuration choice, so the Global Config is the only place one is written: a Project Config has no key setting to layer, and one written there is refused by name rather than read, because that file is meant to be committed. With no key configured, one is read from the environment: a Namespaced API Key first, then the name native to that Provider's own tooling. OpenCode Zen and OpenCode Go share a single key — one console, one key, two routes.
_Avoid_: token (ambiguity with LLM token budget), secret key

**Namespaced API Key**:
A Provider's API Key read from ViCode's own environment variable rather than the one native to the Provider's tooling — `VICODE_OPENAI_API_KEY` where the tooling reads `OPENAI_API_KEY`. It is consulted first, because it is the narrower claim: a credential scoped to this tool outranks one scoped to every other program in the shell, so a user who exports the native variable for its own Provider's tooling can point ViCode at a different account without unsetting it. The native variable still authenticates on its own, so the override is an option and not a second copy to maintain. Reading one never writes back, so the variable it shadows stays untouched for every other tool. The name is derived from the native one — `VICODE_` plus it — so it cannot drift from the name it overrides, and one name covers a console: `VICODE_OPENCODE_API_KEY` authenticates both OpenCode routes. `OPENROUTER_API_KEY` remains the OpenRouter route's own native name, preserved untouched for pipelines that already set it, but it is never offered to another route: a gateway credential is not a working fallback for a Model Vendor.
_Avoid_: fallback variable, alias, override variable (a name says nothing about which way the precedence runs)

**API Key Entry Screen**:
The focused full-overlay surface that prompts the user for a Provider's API Key. It names the Provider it is collecting a key for, and has two modes: required (must be satisfied before the user can chat on that Provider, Cancel disabled) and optional (dismissible). The required mode is the pre-chat gate for the active Provider; the optional mode is opened by `/key` and by `/model` or `/provider` when the picked Model sits on a Provider with no key — walking into a switch is not a reason to hold the user on the screen. Declining a switch's prompt leaves the route as it was and says which key is missing. Saving the key runs the current Session's pending request and the Provider is recreated with the fresh key. A missing key for one Provider never blocks chatting through another.
_Avoid_: key screen, key modal, credential prompt

**Global Config**:
The `~/.vicode/config.json` file. Config Layering gives it priority below Project Config. It is the only place an API Key is written.
_Avoid_: settings file, config file (unqualified)

**Config Layering**:
Configuration priority: Project Config (.vicode.json) > Global Config (~/.vicode/config.json). Runtime changes (Provider, Model, skills) happen via Commands, not CLI flags. A Project Config may pin the Model but never carries an API Key: the Global Config has no counterpart setting to layer, and a key in a Project Config is refused by name rather than read, because that file is meant to be committed.

### Web search

**Search Backend**:
A keyed web search service the agent can ask a real question — a query and a result count in, ranked Search Results out. Two ship, `brave` and `serper`; which one runs is the `searchBackend` config, resolved through the registry. It is deliberately not a Provider: a Provider is a route ViCode chats through and bills per token, and a Search Backend is neither, so it is never selectable as a route and never enters cost accounting. The Tool is written against this shape rather than against any one of them, so a further backend is an entry in a registry instead of a rewiring.
_Avoid_: vendor (Model Vendor's word), provider, engine

**Search Credential**:
The credential authenticating `web_search` to its Search Backend. It is a network credential, not an API Key, so it never reaches a Provider surface — not the picker, not the API Key Entry Screen, not the Route Label, not the Usage Panel, not cost — and it has no `/key` screen because there is no Provider to pick. It gets its own Global Config field, `searchApiKeys` keyed by backend id, rather than an entry in the Provider key map, which holds Provider ids only and would discard it. A Project Config refuses it by name, for the same reason it refuses an API Key: that file is meant to be committed. Read by the same Namespaced API Key rule — the field first, then a `VICODE_`-prefixed variable, then the backend's own native name — so the override stays an option rather than a second copy of the secret to maintain. A missing one is not a pre-chat gate: a Provider key gates because there is no route to chat through without it, and this is not a route, so the absence is reported to the model that asks for a search rather than standing between the user and the chat. That reasoning, and the network credential's place outside the Provider concept, are written down in ADR-0012 and stated alongside the outbound fetch decision in ADR-0013.
_Avoid_: search API key (conflates it with a Provider credential), token, secret key

**Search Result**:
One ranked entry a Search Backend returns: a title to show, a URL to cite, and a snippet of what the page says. Those three are what every search API agrees on, rather than what any one of them happens to call them. A snippet is an excerpt, not a page — the distinction is what tells the model to fetch the URL when it needs the whole thing.

### Conversation persistence

**Session**:
A saved conversation between the user and the agent, stored as JSON at `<project>/.vicode/sessions/<id>.json` — one file per Session. Scoping is physical: a Session lives inside the directory it belongs to, so a project only ever surfaces its own sessions. A Session may carry an optional **name** — a short human name, up to 60 characters, set by `/rename` and shown by `/session` alongside the raw id.
_Avoid_: chat (the view), history

**Session name**:
The optional human name on a Session, set with `/rename <name>` and cleared with `/rename clear` (or `remove`, or `delete` — but only as the sole argument, so `/rename delete the parser` names a session "delete the parser"). It is cosmetic: it changes how a Session is *listed*, never what it contains, and renaming does not change its position in the most-recent-first order. A Session has no name until a first message has been sent, because that is when the Session record comes into being.
_Avoid_: title (a name is not a heading). "label" stays correct for a picker *row* — `PickerItem.label` is the rendering concern, the Session name is the stored fact.

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
The Context Load percentage at which auto-compaction fires within the Agent Loop — 60% of the context window by default. The `/compact` Command is unconditional and ignores the threshold. A Model whose context window is Unknown has no threshold to fire at, so threshold-driven compaction stays off until the Model Catalog knows the window.
_Avoid_: compact limit, context alarm

**Context Load**:
The current estimated size of the message history — the estimated tokens of every message in the array — expressed as a percentage of the model's context window. The honest meter behind the Compact Threshold. Distinct from the Usage Panel's percentage, which reflects cumulative token spend since the session began, not the live in-window size.
_Avoid_: context usage, context-window usage (overlaps the cumulative panel figure)

**Context Shortfall**:
The gap a Model Switch would open: a Context Load larger than the target Model's Context Budget. It is what the switch warns about, stated as the load, the budget, and the target's window rather than a verdict — the user decides, and confirming still switches. A Model whose window is Unknown has no Context Budget to fall short of, so no shortfall is ever computed for it.
_Avoid_: truncation warning, context overflow (names a failure rather than a measurement), context limit

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
The allowed boundary for file operations — the directory a Session lives in. Operations inside it on normal project files run silently; operations outside it require approval and proceed once approved. Surfaced to the user as the Project Root Path.
_Avoid_: current directory, cwd, working directory

**Project Root Path**:
The on-screen rendering of the Project Root — the path alone, with no label and no icon. A path under the user's home directory is shortened to a leading `~`; a Project Root that *is* the home directory collapses to `~` alone; anywhere else shows the path raw. Separators are always forward slashes, so a Windows path reads the same as a POSIX one. Truncated from the left, never wrapped, so the directory name at the end of the path always stays visible; the budget is whatever width the surface it sits on allows, so the same Project Root may render shorter in the narrow Usage Panel than on the wide Welcome Screen. Appears pinned to the bottom edge of the Usage Panel and at the bottom left of the Welcome Screen — the two chrome regions that sit where a user looks to orient themselves. The Status Bar does not carry it.
_Avoid_: cwd indicator, path label, directory breadcrumb

### Layout & rendering

**TUI**:
Terminal User Interface. A text-based UI rendered in the terminal using Ink (React for CLIs).

**Surface**:
A region of the TUI separated from its neighbours by a background shade rather than a border line. The window chrome — Chat Panel, Usage Panel, Status Bar — is laid out as surfaces layered on the App Background, each a shade of grey up the ramp; floating overlays keep borders.

**App Background**:
The color painted behind the entire TUI — applied via a background token on the root container, filling every panel and overlay. Any gaps between Surfaces show App Background.

**Input Box**:
The text-entry region rendered as a borderless box with a raised background shade (`inputShade`), distinct from surrounding surfaces purely by its lighter background. The active Mode is indicated inside it by a Mode Switcher and a one-column left-edge bar, rendered from the Design Token palette; the rest of its styling (background shade, cursor) is untouched. It never yields vertical space, so on a terminal too short for the whole surrounding layout the Switcher and the draft keep their own rows and the overflow is clipped instead. Covers both the Welcome Screen's first-message box and the Chat window's full-width input strip.

**Mode Switcher**:
The strip inside an Input Box that names every registered Mode in registry order (`Build Discuss Plan`), so the whole Mode set is visible at once rather than only the active one. The active Mode carries the Mode Tag — bracketed and painted in its own Design Token color (build blue, discuss purple, plan orange) — while the inactive names sit in the muted token; the one-column left-edge bar beside the strip repeats the active Mode's color. It is a display, not a control: Tab cycles the Mode, and the switcher updates immediately without interrupting a running Turn. Distinct from an Inline Chip, which marks inline code inside prose.
_Avoid_: mode indicator, mode bar, mode picker

**Mode Tag**:
The colored `[Build]`-style label that marks the active Mode inside a Mode Switcher, painted from that Mode's Design Token color (build blue, discuss purple, plan orange). Distinct from the Switcher itself, which also names the inactive Modes, and from an Inline Chip, which marks inline code inside prose.

**Cursor**:
The movable insertion position inside an Input Box draft, rendered as a block (an inverse space) between the text halves. Moved one grapheme cluster at a time by Left/Right arrow keys, or jumped to the start/end with Home/End. Every edit operation acts at it rather than at the string end.
_Avoid_: caret, insertion mark, cursor block

**Cursor-Aware Editing**:
The Input Box editing model where typing, backspace, delete, word-delete (Ctrl+W / Ctrl+Backspace), and Home/End all apply at the Cursor rather than the end of the draft. Draft replacement from outside the component (recalling Input History, `/new`) snaps the Cursor to the end.
_Avoid_: positional editing, in-place editing

**Design Token**:
A named value in the central palette (`COLORS`, `ICONS`) that all UI styling references, so visual language stays consistent instead of using scattered hardcoded colours.

**Route Label**:
The on-screen name of the live route — the canonical `provider/model` id, verbatim — shown wherever the TUI says which Model is live: the Status Bar, the Usage Panel's Model row, the exit summary, the Welcome Screen and the Chat Panel's empty state. One Model is reachable through more than one Provider, so a Model name alone names no bill; the Provider half is what makes a Turn's cost attributable. A Model whose id records no Provider is qualified by the Provider that served it; one with neither shows its id alone rather than a guessed one, and one carrying no id at all reads by its name — a surface with no route to name reads `unknown`. On the Status Bar — a single row of chrome that must not grow to fit a long route — it is cut at the end rather than wrapped, so the Provider stays readable.
_Avoid_: model name, model label (both read as the Model alone), route name

**Code Block**:
A framed region — border plus a dark background shade lighter than the App Background — used to render fenced model output and executed command output.

**Inline Chip**:
A short code snippet inside prose (single-backtick `` `cmd` ``) rendered with a dark background and no border, so it reads as embedded code without a full frame.

**Command Line**:
The first line inside a Tool-Result Code Block — `$ npm run dev` — painted in the primary color to show which command was executed.

**Status Bar**:
Bottom bar showing the Route Label, token count, and cost — `—` when the Model's price is Unknown.

**Turn Status**:
The Status Bar's live indication of agent activity: idle, thinking, running a Tool, waiting for approval, done (with elapsed time), or errored.
_Avoid_: status, activity state

**Usage Panel**:
The right-hand TUI panel showing the live route, context-window usage, running token totals, cost, and turn count. The Context row is always present: an Unknown window reads `—` rather than being hidden or defaulted. Its reading of the Project Root Path is pinned to the panel's bottom edge rather than trailing the rows above it, so the panel keeps a fixed look as the terminal grows; the exit hint sits beneath it.

**Welcome Screen**:
The "home" view shown at startup (and returned to via `/home`): banner, the live route, the New Chat / Resume Session menu, and the first-message input. Keyboard-first — mouse clicks are treated as input noise, never as selections. Banner, menu, and input sit centred; the keyboard hint and the Project Root Path share a single footer pinned to the bottom left, so the view has one bottom edge rather than a hint adrift mid-screen.