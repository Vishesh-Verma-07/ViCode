import type { Message, ToolDefinition, ToolContext } from "./types"
import type { Provider, StreamEvent, TokenUsage } from "./provider"
import { ToolRegistry } from "./tool-registry"
import { log } from "../utils/logger"

const DOOM_LOOP_THRESHOLD = 3

export interface AgentLoopCallbacks {
  onTextDelta(text: string): void
  onToolCallStart(toolCallId: string, toolName: string): void
  onToolCallDelta(toolCallId: string, argsDelta: string): void
  onToolCallEnd(toolCallId: string, toolName: string, args: Record<string, unknown>): void
  onToolResult(toolCallId: string, toolName: string, result: string): void
  onError(error: unknown): void
  requestApproval(toolName: string, args: Record<string, unknown>): Promise<boolean>
}

export interface AgentLoopResult {
  messages: Message[]
  totalUsage: TokenUsage
  doomLoopDetected: boolean
}

function createToolCallSignature(toolName: string, args: Record<string, unknown>): string {
  return `${toolName}:${JSON.stringify(args, Object.keys(args).sort())}`
}

function isDoomLoop(history: string[], threshold: number): boolean {
  if (history.length < threshold) return false
  const recent = history.slice(-threshold)
  return recent.every((s) => s === recent[0])
}

let idCounter = 0
function nextId(): string {
  return `msg_${Date.now()}_${++idCounter}`
}

async function executeTool(
  tool: ToolDefinition,
  args: Record<string, unknown>,
  context: ToolContext,
): Promise<string> {
  try {
    return await tool.execute(args, context)
  } catch (error) {
    return `Error: ${error instanceof Error ? error.message : String(error)}`
  }
}

export async function runAgentLoop(
  messages: Message[],
  provider: Provider,
  tools: ToolDefinition[],
  systemPrompt: string,
  context: ToolContext,
  callbacks: AgentLoopCallbacks,
  abortSignal?: AbortSignal,
): Promise<AgentLoopResult> {
  const allMessages = [...messages]
  const toolCallHistory: string[] = []
  let totalUsage: TokenUsage = { inputTokens: 0, outputTokens: 0, totalTokens: 0, cost: 0 }
  let doomLoopDetected = false

  const registry = new ToolRegistry()
  registry.registerAll(tools)

  while (!abortSignal?.aborted) {
    let assistantText = ""
    const assistantToolCalls: Array<{
      toolCallId: string
      toolName: string
      args: Record<string, unknown>
    }> = []
    let hasToolCalls = false
    let stepUsage: TokenUsage | undefined

    try {
      for await (const event of provider.streamChat(allMessages, tools, systemPrompt, abortSignal)) {
        if (abortSignal?.aborted) break

        //@ts-ignore
        log("this is event", event.responseBody)

        switch (event.type) {
          case "text-delta":
            assistantText += event.text ?? ""
            callbacks.onTextDelta(event.text ?? "")
            break

          case "tool-call-start":
            hasToolCalls = true
            callbacks.onToolCallStart(event.toolCallId ?? "", event.toolName ?? "")
            break

          case "tool-call-delta":
            callbacks.onToolCallDelta(event.toolCallId ?? "", event.argsDelta ?? "")
            break

          case "tool-call-end": {
            const toolCallId = event.toolCallId ?? ""
            const toolName = event.toolName ?? ""
            const args = (event.args ?? {}) as Record<string, unknown>
            hasToolCalls = true
            assistantToolCalls.push({ toolCallId, toolName, args })
            callbacks.onToolCallEnd(toolCallId, toolName, args)
            break
          }

          case "finish":
            stepUsage = event.usage
            break

          case "error":
            callbacks.onError(event.error)
            break
        }
      }
    } catch (error) {
      log(error)
      callbacks.onError(error)
      break
    }

    if (stepUsage) {
      totalUsage = {
        inputTokens: totalUsage.inputTokens + stepUsage.inputTokens,
        outputTokens: totalUsage.outputTokens + stepUsage.outputTokens,
        totalTokens: totalUsage.totalTokens + stepUsage.totalTokens,
        cost: (totalUsage.cost ?? 0) + (stepUsage.cost ?? 0),
      }
    }

    if (abortSignal?.aborted) break

    const assistantContent: Array<
      | { type: "text"; text: string }
      | { type: "tool-call"; toolCallId: string; toolName: string; args: Record<string, unknown> }
    > = []

    if (assistantText) {
      assistantContent.push({ type: "text", text: assistantText })
    }
    for (const tc of assistantToolCalls) {
      assistantContent.push({ type: "tool-call", toolCallId: tc.toolCallId, toolName: tc.toolName, args: tc.args })
    }

    if (assistantContent.length > 0) {
      allMessages.push({
        id: nextId(),
        role: "assistant",
        content: assistantContent,
        timestamp: Date.now(),
      })
    }

    if (!hasToolCalls) break

    for (const tc of assistantToolCalls) {
      const signature = createToolCallSignature(tc.toolName, tc.args)
      toolCallHistory.push(signature)

      if (isDoomLoop(toolCallHistory, DOOM_LOOP_THRESHOLD)) {
        doomLoopDetected = true
        allMessages.push({
          id: nextId(),
          role: "assistant",
          content: [{ type: "text", text: "Doom loop detected: repeated identical tool calls. Stopping to prevent infinite retries." }],
          timestamp: Date.now(),
        })
        break
      }

      const toolDef = registry.get(tc.toolName)
      let result: string

      if (!toolDef) {
        result = `Error: Unknown tool "${tc.toolName}"`
      } else if (toolDef.dangerous) {
        const approved = await callbacks.requestApproval(tc.toolName, tc.args)
        if (!approved) {
          result = "User rejected this tool call."
        } else {
          result = await executeTool(toolDef, tc.args, context)
        }
      } else {
        result = await executeTool(toolDef, tc.args, context)
      }

      callbacks.onToolResult(tc.toolCallId, tc.toolName, result)

      allMessages.push({
        id: nextId(),
        role: "tool",
        content: [{ type: "tool-result", toolCallId: tc.toolCallId, toolName: tc.toolName, result }],
        timestamp: Date.now(),
      })
    }

    if (doomLoopDetected) break
  }

  return { messages: allMessages, totalUsage, doomLoopDetected }
}
