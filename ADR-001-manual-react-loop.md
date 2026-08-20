# ADR-001: Manual ReAct Loop over Vercel AI SDK maxSteps

## Status

Accepted

## Context

The Vercel AI SDK provides a built-in multi-step agent loop via `generateText({ maxSteps: 20 })`. This automatically handles the LLM → tool call → execute → feed back cycle. However, building a TUI agent requires fine-grained control over:

1. Streaming text to the UI as tokens arrive (not after the full response)
2. Intercepting tool calls to display them in the sidebar before execution
3. Checking the `dangerous` flag and prompting for user approval mid-loop
4. Tracking per-step token usage and cost
5. Detecting doom loops (repeated identical tool calls) and injecting warnings
6. Allowing the user to cancel mid-generation with Escape

The `maxSteps` approach batches these concerns inside the SDK, making them difficult or impossible to intercept at the right moments for a rich TUI experience.

## Decision

Implement a **manual ReAct loop** in `src/core/agent-loop.ts` that calls `streamText()` from the Vercel AI SDK at each step, processes streaming events as they arrive, and manages tool execution, permission checks, and state updates externally.

## Consequences

- **Positive**: Full control over streaming display, tool call interception, approval prompts, cancellation, cost tracking, and doom-loop detection.
- **Positive**: UI state can be updated in real-time as each streaming event arrives.
- **Positive**: Easier to debug — each step of the loop is visible and controllable.
- **Negative**: More code to maintain (the loop itself, event processing, error handling).
- **Negative**: Must manually handle edge cases the SDK would handle (empty responses, malformed tool calls, provider-specific quirks).
- **Mitigation**: The `Provider` interface abstracts provider-specific quirks. The Vercel AI SDK's `streamText()` still handles the actual HTTP calls, tokenization, and response parsing — we only control the outer loop.
