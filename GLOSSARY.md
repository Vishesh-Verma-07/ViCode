# ViCode Domain Glossary

| Term | Definition |
|------|-----------|
| **Agent Loop** | The core ReAct cycle: send messages to LLM → receive response → parse tool calls → execute tools → feed results back → repeat until no more tool calls. |
| **Tool** | A function the LLM can invoke to interact with the filesystem or shell. Each tool has a name, description, Zod parameter schema, and execute function. |
| **Dangerous Tool** | A tool that can modify state (write files, execute commands). Approval attaches to individual Tool Calls, not whole tools: normal project file edits run silently, calls targeting Sensitive Paths require user approval, and every `bash` call requires approval. |
| **Sensitive Path** | A file path protected from unsupervised access — matched by default patterns (`.env*`, key material, credential stores, `.ssh/**`) plus user-configured patterns. Writes and edits pause for approval; reads are refused entirely; search results omit matches inside them. |
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
