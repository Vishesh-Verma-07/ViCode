## Problem Statement

The user wants to build an interactive terminal UI (TUI) coding agent — similar to OpenCode and Claude Code — that allows a developer to have a conversation with an LLM which can read, write, and edit files and execute shell commands in their project directory. The project currently has only a bare Bun + TypeScript scaffold (`index.ts` stub, no dependencies) and a library of 25 agent skill definitions. No agent runtime, no TUI, no LLM integration, and no tool implementations exist.

## Solution

Build a two-panel TUI agent called **ViCode** (`vicode`) that:

1. Renders a chat interface (left panel) and a tabbed tool/diff sidebar (right panel) using Ink (React for CLIs).
2. Connects to any model via OpenRouter using the Vercel AI SDK + `@openrouter/ai-sdk-provider`.
3. Runs a manual ReAct agent loop: user input → LLM call → parse tool calls → execute tools → feed results back → repeat until LLM stops calling tools.
4. Provides six core tools: `read_file`, `write_file`, `edit_file`, `list_files`, `bash`, `search`.
5. Requires user approval before executing dangerous tools (`bash`, `write_file`, `edit_file`).
6. Persists conversation history as JSON files, auto-saved per project directory.
7. Displays live token usage and estimated cost in a status bar, plus an exit summary.
8. Loads layered configuration: global defaults (`~/.vicode/config.json`) overridden by project-level config (`.vicode.json` in project root).
9. Uses a layered system prompt: hardcoded base prompt + optional project prompt + user overrides.

## User Stories

### Core Chat & Agent Loop

1. As a developer, I want to run `vicode` in my project directory and start chatting with an AI coding agent, so that I can get help with my code without leaving the terminal.
2. As a developer, I want to type a message and see it appear in the chat panel immediately, so that I know my input was received.
3. As a developer, I want to see the LLM's response stream token-by-token into the chat panel, so that I get real-time feedback while it's thinking.
4. As a developer, I want the agent to automatically call tools and show the results in the sidebar, so that I can follow its reasoning and actions.
5. As a developer, I want the agent to stop automatically when it has no more tool calls to make, so that I can review its final answer.
6. As a developer, I want the agent to run a manual ReAct loop (not a fire-and-forget batch), so that I see intermediate tool calls and can intervene if needed.
7. As a developer, I want the agent to detect doom loops (repeated identical tool calls), so that it doesn't waste tokens on infinite retries.

### Tool Execution

8. As a developer, I want the agent to read any file in my project via `read_file`, so that it can understand my codebase.
9. As a developer, I want the agent to list directory contents and glob patterns via `list_files`, so that it can discover project structure.
10. As a developer, I want the agent to search across my codebase via `search` (grep/regex), so that it can find relevant code quickly.
11. As a developer, I want the agent to write new files or overwrite existing files via `write_file`, so that it can create or replace code.
12. As a developer, I want the agent to apply targeted edits to existing files via `edit_file` (diff-style), so that it can make precise changes without rewriting entire files.
13. As a developer, I want the agent to execute shell commands via `bash`, so that it can run tests, build projects, install packages, and perform other system operations.
14. As a developer, I want the agent to show me what it's about to do before executing dangerous tools (`bash`, `write_file`, `edit_file`), so that I can approve or reject the action.
15. As a developer, I want to approve or reject a pending tool call with a simple keypress (y/n), so that the workflow stays fast.
16. As a developer, I want rejected tool calls to be reported back to the LLM as "user rejected", so that the agent can adjust its approach.
17. As a developer, I want tool execution results to be truncated in the sidebar if they're very long, so that the UI doesn't get overwhelmed.

### Two-Panel UI

18. As a developer, I want a left panel showing the conversation (user messages + assistant responses), so that I can follow the full dialogue.
19. As a developer, I want a right sidebar with two tabs — "Tools" and "Diffs" — so that I can switch between viewing tool call logs and file change previews.
20. As a developer, I want the "Tools" tab to show each tool call in sequence with its name, arguments, and result, so that I can debug the agent's actions.
21. As a developer, I want the "Diffs" tab to show colored diffs after `edit_file`/`write_file` operations, so that I can review changes before they're committed.
22. As a developer, I want the sidebar to auto-scroll to the latest entry when a new tool call or diff appears, so that I don't have to manually scroll.
23. As a developer, I want the panels to be responsive to terminal resize, so that the layout adapts when I resize my terminal window.
24. As a developer, I want a status bar at the bottom showing the current model, token count, and estimated cost, so that I can monitor my usage in real time.

### Input & Navigation

25. As a developer, I want to type multi-line input (using Shift+Enter or a similar mechanism), so that I can paste code snippets or write longer prompts.
26. As a developer, I want to scroll up through the chat history, so that I can review earlier parts of the conversation.
27. As a developer, I want to press Escape to cancel an in-progress LLM response, so that I can stop a runaway generation.
28. As a developer, I want keyboard shortcuts to switch between sidebar tabs (e.g., Tab key), so that I don't need to use the mouse.

### Configuration

29. As a developer, I want a global config file at `~/.vicode/config.json` where I store my OpenRouter API key and default preferences, so that I don't have to configure them every session.
30. As a developer, I want a project-level config file at `.vicode.json` in my project root to override the model or system prompt for this specific project, so that different projects can use different settings.
31. As a developer, I want config to be loaded in layers (global → project → CLI flags), so that the most specific setting wins.
32. As a developer, I want the CLI to accept `--model <model>` to override the configured model, so that I can quickly test different models.
33. As a developer, I want the CLI to accept `--system <file>` to load a custom system prompt from a file, so that I can tailor the agent's behavior per session.
34. As a developer, I want the CLI to accept an optional directory argument `vicode [dir]` to start in a specific directory, so that I can launch from anywhere.

### System Prompt

35. As a developer, I want a base system prompt that instructs the agent on tool usage, code style, and safety, so that the agent behaves consistently.
36. As a developer, I want a project-level system prompt loaded from `.vicode/system.md` (or configured in `.vicode.json`), so that the agent understands project-specific conventions.
37. As a developer, I want the system prompt to be layered (base + project + user overrides), so that I can add context without replacing the defaults.

### Session Persistence

38. As a developer, I want my conversation to be auto-saved as a JSON file after every turn, so that I never lose progress.
39. As a developer, I want sessions to be stored at `~/.vicode/sessions/<project-hash>/<timestamp>.json`, so that each project's history is isolated.
40. As a developer, I want to resume a previous session when I restart `vicode` in the same directory, so that I can pick up where I left off.
41. As a developer, I want to see a list of past sessions with timestamps and message counts, so that I can choose which one to resume.
42. As a developer, I want to start a fresh session explicitly (e.g., `vicode --new`), so that I can begin a clean conversation.

### Token & Cost Tracking

43. As a developer, I want to see the total tokens used and estimated cost after each LLM turn in the status bar, so that I can monitor my spending.
44. As a developer, I want to see a cost summary when I exit the agent, so that I know the total cost of my session.
45. As a developer, I want the cost calculation to use OpenRouter's published pricing per model, so that the estimates are accurate.

### Error Handling & Resilience

46. As a developer, I want clear error messages when my API key is missing or invalid, so that I can fix configuration issues quickly.
47. As a developer, I want the agent to handle LLM API rate limits gracefully (retry with backoff), so that transient errors don't crash the session.
48. As a developer, I want tool execution errors to be caught and reported to the LLM, so that the agent can try a different approach.
49. As a developer, I want the agent to gracefully handle terminal disconnects without corrupting saved sessions, so that my data is safe.
50. As a developer, I want a `--help` flag that shows usage information, so that I can learn how to use the tool.

## Implementation Decisions

### Architecture

The project is organized into four layers with clear dependency boundaries:

```
src/
  core/       — Agent loop, tool registry, message types. No UI or provider imports.
  providers/  — LLM provider abstraction (OpenRouter via Vercel AI SDK). Depends on core types only.
  ui/         — Ink React components. Depends on core types only.
  config/     — Config loading (global + project + CLI args). Depends on core types only.
  tools/      — Tool implementations (read_file, bash, etc.). Depends on core types only.
  cli.ts      — Entry point. Wires config → providers → core → ui.
```

Dependency rule: `core` is the innermost layer with zero external dependencies beyond Zod. `providers`, `ui`, `tools`, and `config` depend on `core` but never on each other. `cli.ts` is the composition root that wires everything together.

### Provider Seam (highest seam)

The LLM provider is abstracted behind a `Provider` interface defined in `src/core/provider.ts`. This interface exposes:

- `streamChat(messages, tools)` — Returns an async iterator of streaming events (text deltas, tool call deltas, finish signals).
- `getModelInfo()` — Returns model metadata (name, context window, pricing).

OpenRouter is the first (and initially only) implementation, built on `@openrouter/ai-sdk-provider` + Vercel AI SDK's `streamText()`. The provider seam means any future provider (local Ollama, Anthropic direct, etc.) can be added by implementing the `Provider` interface without touching the agent loop or UI.

### Tool Seam

Tools are registered via a `ToolRegistry` defined in `src/core/tool-registry.ts`. Each tool declares:

- `name` — Unique identifier (e.g., `read_file`)
- `description` — What the tool does (sent to the LLM)
- `parameters` — Zod schema for the tool's arguments
- `execute(args, context)` — Async function that runs the tool and returns a string result
- `dangerous` — Boolean flag; if true, requires user approval before execution

The agent loop iterates over tool calls from the LLM, looks up each tool in the registry, checks the `dangerous` flag, prompts for approval if needed, executes, and feeds the result back. This seam allows adding new tools by simply registering them — no changes to the agent loop.

### Agent Loop (Manual ReAct)

The agent loop is implemented in `src/core/agent-loop.ts` as a manual ReAct loop (not Vercel AI SDK's `maxSteps`). This gives full control over:

1. Streaming text to the UI as tokens arrive
2. Intercepting tool calls for UI display and permission checks
3. Doom-loop detection (tracking repeated identical tool calls, bailing after N repetitions)
4. Graceful cancellation (user presses Escape to abort)
5. Cost tracking per step

The loop structure:

```
loop:
  1. Call provider.streamChat(messages, tools)
  2. For each streaming event:
     - text_delta → update UI with new token
     - tool_call_start → display tool call in sidebar, check dangerous flag
     - tool_call_delta → update tool args in sidebar as they stream
     - tool_call_end → execute tool (or prompt for approval), append result to messages
  3. If no tool calls in response → break (LLM is done)
  4. If doom loop detected → inject warning, break
  5. Go to step 1
```

### Tool Permission Model

Dangerous tools (`bash`, `write_file`, `edit_file`) pause the loop and display an approval prompt in the UI. The user presses `y` to approve or `n` to reject. Rejected calls send a `"user rejected this tool call"` message back to the LLM so it can adjust. Non-dangerous tools (`read_file`, `list_files`, `search`) execute immediately.

### Configuration Layering

Configuration is loaded in this priority order (highest wins):

1. CLI flags (`--model`, `--system`)
2. Project config (`.vicode.json` in project root)
3. Global config (`~/.vicode/config.json`)

Config schema (validated with Zod):

```
{
  apiKey?: string,          // OpenRouter API key
  model?: string,           // Model identifier (e.g., "anthropic/claude-sonnet-4")
  systemPrompt?: string,    // Additional system prompt text or path to .md file
  theme?: "dark" | "light"  // UI theme (future)
}
```

### System Prompt Layering

The system prompt is assembled in three layers:

1. **Base prompt** — Hardcoded. Instructs the agent on available tools, code style conventions, safety rules, and response format.
2. **Project prompt** — Loaded from `.vicode/system.md` if it exists, or from the `systemPrompt` field in `.vicode.json`.
3. **User overrides** — Appended via `--system <file>` CLI flag.

All three are concatenated and sent as the system message to the LLM.

### Session Persistence

Sessions are stored as JSON files at `~/.vicode/sessions/<project-hash>/<timestamp>.json`. The project hash is derived from the absolute path of the project directory (e.g., SHA-256 truncated to 8 chars). Each session file contains:

- `id` — Unique session ID
- `projectPath` — Absolute path to the project directory
- `model` — Model used for this session
- `messages` — Full message array (user, assistant, tool calls, tool results)
- `createdAt` — ISO timestamp
- `updatedAt` — ISO timestamp
- `totalTokens` — Cumulative token count
- `totalCost` — Cumulative cost estimate

Sessions are auto-saved after every LLM turn. When `vicode` starts in a directory, it checks for existing sessions and offers to resume the most recent one.

### UI Components (Ink)

The UI is built with Ink 6.x + React 19. Key components:

- **App** — Root component, manages global state (messages, tool calls, config, active tab)
- **ChatPanel** — Left panel. Renders conversation messages, handles input.
- **Sidebar** — Right panel. Tabbed: "Tools" tab shows tool call log, "Diffs" tab shows file diffs.
- **StatusBar** — Bottom bar. Shows model name, token count, estimated cost.
- **ApprovalPrompt** — Overlay that appears when a dangerous tool needs approval.
- **MessageBubble** — Renders a single message (user or assistant) with markdown support.
- **ToolCallEntry** — Renders a single tool call in the sidebar with name, args, and result.
- **DiffView** — Renders a unified diff with color highlighting.

Streaming is handled via React state: token deltas update state, triggering Ink re-renders. No manual terminal manipulation.

### CLI Interface

```
vicode [directory] [options]

Options:
  --model <model>     Override the configured model
  --system <file>     Load a custom system prompt from a file
  --new               Start a fresh session (don't resume previous)
  --sessions          List past sessions for this directory
  --resume <id>       Resume a specific session by ID
  --help              Show usage information
```

The entry point (`src/cli.ts`) parses arguments with Bun's built-in argument parser, loads config, initializes the provider, creates the agent loop, and renders the Ink app.

### Core Tools Implementation

| Tool | Arguments | Returns | Dangerous |
|------|-----------|---------|-----------|
| `read_file` | `{ path: string }` | File contents as string | No |
| `write_file` | `{ path: string, content: string }` | Confirmation message | Yes |
| `edit_file` | `{ path: string, oldText: string, newText: string }` | Confirmation with diff | Yes |
| `list_files` | `{ path: string, pattern?: string }` | Directory listing or glob matches | No |
| `bash` | `{ command: string, cwd?: string }` | Command stdout + stderr | Yes |
| `search` | `{ pattern: string, path?: string, include?: string }` | Grep results with line numbers | No |

All tools use Zod schemas for argument validation. Results are returned as strings (truncated in the UI if over 500 lines).

### Token & Cost Tracking

Token usage is extracted from the Vercel AI SDK's response metadata after each LLM call. OpenRouter provides `prompt_tokens`, `completion_tokens`, and `total_tokens` in the response. Cost is calculated using OpenRouter's per-model pricing (fetched or hardcoded for known models). The status bar updates after every turn, and a summary is printed on exit.

### Dependencies

```
Dependencies:
  ink                     — Terminal UI framework (React for CLIs)
  react                   — React 19 (peer dep of Ink)
  @inkjs/ui               — Ink UI components
  ai                      — Vercel AI SDK v5
  @openrouter/ai-sdk-provider — OpenRouter provider for Vercel AI SDK
  zod                     — Schema validation (for tool params and config)
  diff                    — Text diffing library (for edit_file diffs)
  chalk                   — Terminal color output (used in diffs and status)

Dev Dependencies:
  @types/bun              — Bun type definitions
  @types/react            — React type definitions
  typescript              — TypeScript compiler
```

## Testing Decisions

### Testing Philosophy

Tests should verify **external behavior**, not implementation details. A good test answers: "If I use this module as a black box, does it do what it promises?" Mocks should be used sparingly and only at seam boundaries (provider, file system, terminal input).

### Seam-Based Testing

The four seams identified above map to four test categories:

1. **Provider seam** — Mock the OpenRouter API response. Verify the agent loop correctly processes streaming events, tool calls, and text deltas. Test doom-loop detection, cancellation, and error handling.
2. **Tool seam** — Mock the file system (Bun's `Bun.file()`, `Bun.write()`, `Bun.spawn()`). Verify each tool reads/writes/executes correctly. Test permission checks (dangerous flag). Test error cases (file not found, permission denied).
3. **Config seam** — Mock the file system. Verify config loads correctly from global, project, and CLI sources. Test merge priority (CLI > project > global). Test missing config, malformed JSON, invalid schemas.
4. **Session seam** — Mock the file system. Verify sessions save and load correctly. Test auto-save after turns. Test session listing and resume.

### UI Testing

Ink provides test utilities (`ink-testing-library`) for rendering components in a simulated terminal. Tests should verify:

- Correct components render for given state (e.g., approval prompt appears when dangerous tool is pending)
- Tab switching works
- Status bar shows correct values
- Messages render in correct order

### Integration Testing

One integration test that boots the full agent with a mock provider, sends a message, and verifies the complete loop (message → LLM → tool call → approval → tool execution → result → LLM → final response). This tests the wiring in `cli.ts` end-to-end.

### Test Runner

Bun's built-in test runner (`bun test`). No additional test framework needed.

## Out of Scope

- **Kilo Code integration** — Deferred. May be revisited as a future provider.
- **MCP (Model Context Protocol) support** — Not in MVP. The tool registry is designed to accommodate MCP tools later.
- **Multi-file edit operations** — `edit_file` handles single-file targeted edits. Atomic multi-file transactions are out of scope.
- **Git integration** — The agent can use `bash` to run git commands, but there's no dedicated git tool or UI.
- **LSP integration** — No language server protocol support. The agent reads files directly.
- **Authentication/authorization** — No user accounts. API key is the only auth mechanism.
- **Themes/customization** — Config has a `theme` field placeholder but no theme system in MVP.
- **Plugin system** — Tools are hardcoded in the registry. Dynamic plugin loading is out of scope.
- **Streaming cost estimation** — Cost is calculated after the full response, not estimated during streaming.
- **Context window management/compaction** — No summarization or truncation of old messages when approaching token limits. The LLM will hit its context limit naturally.

## Further Notes

- The project uses **Bun** as the runtime (not Node.js). All file I/O, process spawning, and HTTP should use Bun-native APIs where available.
- The `tsconfig.json` has `"jsx": "react-jsx"` which is compatible with Ink 6.x.
- The existing `index.ts` stub and `package.json` bin entry should be replaced — `index.ts` becomes a thin redirect to `src/cli.ts`, or is replaced entirely.
- OpenRouter API key should be read from `OPENROUTER_API_KEY` environment variable as a fallback if not in config.
- The agent should print a helpful error message if no API key is found (pointing to config setup).
