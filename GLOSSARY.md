# ViCode Domain Glossary

| Term | Definition |
|------|-----------|
| **Agent Loop** | The core ReAct cycle: send messages to LLM → receive response → parse tool calls → execute tools → feed results back → repeat until no more tool calls. |
| **Tool** | A function the LLM can invoke to interact with the filesystem or shell. Each tool has a name, description, Zod parameter schema, and execute function. |
| **Approval Rule** | The rule deciding whether a Tool Call pauses for user approval: a call pauses iff it is a `bash` call, or a file operation whose target is a Sensitive Path or lies outside the Project Root. Approval attaches to individual Tool Calls, not whole tools. | Approving a resolved path also auto-approves later calls to that same path for the rest of the Turn, so each distinct path surfaces at most one explicit approval per Turn.
| **Bash Allowlist** | The user-configured set of first command tokens (configured via the `silentBashCommands` setting, merged across config layers) whose bash Tool Calls may run as Silent Bash Calls. _Avoid_: whitelist, allow list. |
| **Silent Bash Call** | A bash Tool Call that executes without pausing for user approval because its first command token is on the Bash Allowlist, no command token resolves to a Sensitive Path, and its resolved working directory stays inside the Project Root and is not a Sensitive Path. _Avoid_: silent command, approval-free bash. |
| **Sensitive Path** | A file path protected from unsupervised access — matched by default patterns (`.env*`, key material, credential stores, `.ssh/**`) plus user-configured patterns. Reads, writes, and edits pause for approval (reads too, not just writes and edits); search results omit matches inside them. |
| **Project Root** | The allowed boundary for file operations — the directory a Session is associated with. Operations inside it on normal project files run silently; operations outside it require approval and proceed once approved. |
| **Provider** | An LLM backend (e.g., OpenRouter) that the agent sends messages to and receives responses from. Abstracted behind a `Provider` interface. |
| **Seam** | A boundary between modules where behavior can be swapped or mocked for testing. The four seams are: Provider, Tool, Config, and Session. |
| **ReAct Loop** | Reasoning + Acting loop pattern. The LLM reasons about what to do, calls a tool, observes the result, and decides the next step. |
| **Doom Loop** | When the LLM repeatedly calls the same tool with the same arguments, indicating it's stuck. Detected and terminated automatically. |
| **System Prompt** | Instructions sent to the LLM at the start of the conversation defining its behavior, available tools, and constraints. Layered: base + project + user. |
| **Session** | A saved conversation between the user and the agent, stored as JSON, associated with a project directory. |
| **Tool Call** | An invocation of a tool by the LLM, consisting of the tool name and its arguments. |
| **Streaming** | Token-by-token delivery of the LLM response, rendered in real-time in the UI. |
| **TUI** | Terminal User Interface. A text-based UI rendered in the terminal using Ink (React for CLIs). |
| **Sidebar** | The right panel of the two-panel layout, showing tool call logs and file diffs in tabbed view. |
| **Status Bar** | Bottom bar showing model name, token count, and estimated cost. |
| **Command** | A user-invoked application action typed as a slash command (e.g., `/new`, `/model`) in the chat input. Distinct from a Tool, which is invoked by the LLM. An input is treated as a Command attempt only if its first word starts with `/`. |
| **Skill** | A markdown instruction file whose full content is injected as a System Prompt layer when activated via `/skill`, shaping agent behavior until the session ends. Discovered from project `.vicode/skills/` and global `~/.vicode/skills/`; project wins on name collision. Multiple active Skills stack. |
| **Command Suggestion** | The dropdown rendered above the chat input listing matching Commands as the user types after `/`. Shows a "no commands match" state when nothing matches. |
| **Config Layering** | Configuration priority: project config (.vicode.json) > global config (~/.vicode/config.json). Runtime changes (model, skills) happen via Commands, not CLI flags. |
| **Project Hash** | A truncated SHA-256 hash of the project directory's absolute path, used to namespace session storage. |
| **Surface** | A region of the TUI separated from its neighbours by a background shade rather than a border line. The window chrome — Chat Panel, Usage Panel, Status Bar — is laid out as surfaces layered on the App Background, each a shade of grey up the ramp; floating overlays keep borders. |
| **Input Box** | The text-entry region rendered as a borderless box with a raised background shade (`inputShade`), distinct from surrounding surfaces purely by its lighter background. Covers both the Welcome Screen's first-message box and the Chat window's full-width input strip. |
| **App Background** | The color painted behind the entire TUI — applied via a background token on the root container, filling every panel and overlay. Any gaps between Surfaces show App Background. |
| **Design Token** | A named value in the central palette (`COLORS`, `ICONS`) that all UI styling references, so visual language stays consistent instead of using scattered hardcoded colors. |
| **Code Block** | A framed region — border plus a dark background shade lighter than the App Background — used to render fenced model output and executed command output. |
| **Inline Chip** | A short code snippet inside prose (single-backtick `` `cmd` ``) rendered with a dark background and no border, so it reads as embedded code without a full frame. |
| **Command Line** | The first line inside a tool-result Code Block — `$ npm run dev` — painted in the primary color to show which command was executed. |
| **Turn** | One user message plus the agent's complete response cycle — reasoning, tool calls, and tool results — until it stops and yields the floor. |
| **Turn Status** | The Status Bar's live indication of agent activity: idle, thinking, running a tool, waiting for approval, done (with elapsed time), or errored. |
| **Approval Prompt** | The overlay shown while a Tool Call awaits user consent, displaying the tool name and arguments and accepting `y`/`n`. |
| **Usage Panel** | The right-hand TUI panel showing the active model, context-window usage, running token totals, cost, and turn count. |
| **Welcome Screen** | The "home" view shown at startup (and returned to via `/home`): banner, model info, the New Chat / Resume Session menu, and the first-message input. Keyboard-first — mouse clicks are treated as input noise, never as selections. |
| **New Chat** | The Welcome Screen action that begins a fresh conversation. It is identical in behaviour to the `/new` command: the current Session (if any) is saved, then messages, usage, unit counters and active Skills are cleared and the chat view opens empty. |
| **Input History** | The in-memory, session-scoped list of every Input the user submits (Messages and Commands alike), recalled into the Input Box draft by Up/Down arrows. Cleared by New Chat. Recalling is drafting, not replaying: a recalled Input is a fresh message on submit, not a re-run of the old turn. |
