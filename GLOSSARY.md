# ViCode Domain Glossary

| Term | Definition |
|------|-----------|
| **Agent Loop** | The core ReAct cycle: send messages to LLM → receive response → parse tool calls → execute tools → feed results back → repeat until no more tool calls. |
| **Tool** | A function the LLM can invoke to interact with the filesystem or shell. Each tool has a name, description, Zod parameter schema, and execute function. |
| **Dangerous Tool** | A tool that can modify state (write files, execute commands). Requires user approval before execution. |
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
| **Config Layering** | Configuration priority: CLI flags > project config (.vicode.json) > global config (~/.vicode/config.json). |
| **Project Hash** | A truncated SHA-256 hash of the project directory's absolute path, used to namespace session storage. |
