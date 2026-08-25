import { describe, it, expect, beforeEach, afterEach } from "bun:test"
import { runAgentLoop, type AgentLoopCallbacks } from "./agent-loop"
import type { Provider, StreamEvent } from "./provider"
import type { Message, ToolDefinition, ToolContext } from "./types"
import { z } from "zod"
import { mkdirSync, rmSync, existsSync, readFileSync, writeFileSync } from "fs"
import { join } from "path"
import { writeFileTool } from "../tools/write-file"
import { bashTool } from "../tools/bash"

function createMockProvider(events: StreamEvent[][]): Provider {
  let callIndex = 0
  return {
    async *streamChat(): AsyncIterable<StreamEvent> {
      const batch = events[callIndex++] ?? []
      for (const event of batch) {
        yield event
      }
    },
    getModelInfo() {
      return { id: "mock", name: "Mock Model" }
    },
    async listModels() {
      return []
    },
  }
}

function createMockCallbacks(overrides?: Partial<AgentLoopCallbacks>): AgentLoopCallbacks {
  return {
    onTextDelta: () => {},
    onToolCallStart: () => {},
    onToolCallDelta: () => {},
    onToolCallEnd: () => {},
    onToolResult: () => {},
    onError: () => {},
    requestApproval: async () => true,
    ...overrides,
  }
}

const mockContext: ToolContext = { projectPath: "/tmp/test" }

const realToolsDir = join(import.meta.dir, "__tmp_agent_loop_tools_test")

beforeEach(() => {
  if (existsSync(realToolsDir)) rmSync(realToolsDir, { recursive: true })
  mkdirSync(realToolsDir, { recursive: true })
})

afterEach(() => {
  if (existsSync(realToolsDir)) rmSync(realToolsDir, { recursive: true })
})

function userMessage(text: string): Message {
  return {
    id: "user_1",
    role: "user",
    content: [{ type: "text", text }],
    timestamp: Date.now(),
  }
}

describe("agent-loop", () => {
  it("returns assistant text when LLM produces no tool calls", async () => {
    const provider = createMockProvider([
      [
        { type: "text-delta", text: "Hello" },
        { type: "text-delta", text: " world" },
        { type: "finish", usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15, cost: 0 } },
      ],
    ])

    const result = await runAgentLoop(
      [userMessage("Hi")],
      provider,
      [],
      "system",
      mockContext,
      createMockCallbacks(),
    )

    expect(result.messages).toHaveLength(2)
    expect(result.messages[1]!.role).toBe("assistant")
    expect(result.totalUsage.totalTokens).toBe(15)
  })

  it("streams text deltas to onTextDelta callback", async () => {
    const deltas: string[] = []
    const provider = createMockProvider([
      [
        { type: "text-delta", text: "A" },
        { type: "text-delta", text: "B" },
        { type: "finish", usage: { inputTokens: 1, outputTokens: 2, totalTokens: 3, cost: 0 } },
      ],
    ])

    await runAgentLoop(
      [userMessage("test")],
      provider,
      [],
      "system",
      mockContext,
      createMockCallbacks({ onTextDelta: (t) => deltas.push(t) }),
    )

    expect(deltas).toEqual(["A", "B"])
  })

  it("executes a tool call and feeds result back", async () => {
    const echoTool: ToolDefinition = {
      name: "echo",
      description: "Echo input",
      parameters: z.object({ input: z.string() }),
      execute: async (args) => `echoed: ${args.input}`,
      dangerous: false,
    }

    const provider = createMockProvider([
      [
        { type: "tool-call-start", toolCallId: "call_1", toolName: "echo" },
        { type: "tool-call-end", toolCallId: "call_1", toolName: "echo", args: { input: "hi" } },
        { type: "finish", usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15, cost: 0 } },
      ],
      [
        { type: "text-delta", text: "Done" },
        { type: "finish", usage: { inputTokens: 5, outputTokens: 3, totalTokens: 8, cost: 0 } },
      ],
    ])

    const results: Array<{ id: string; name: string; result: string }> = []
    const result = await runAgentLoop(
      [userMessage("echo hi")],
      provider,
      [echoTool],
      "system",
      mockContext,
      createMockCallbacks({
        onToolResult: (id, name, r) => results.push({ id, name, result: r }),
      }),
    )

    expect(results).toHaveLength(1)
    expect(results[0]!.result).toBe("echoed: hi")
    expect(result.messages).toHaveLength(4)
    expect(result.messages[2]!.role).toBe("tool")
    expect(result.totalUsage.totalTokens).toBe(23)
  })

  it("terminates when LLM produces no tool calls", async () => {
    const provider = createMockProvider([
      [
        { type: "text-delta", text: "Final answer" },
        { type: "finish", usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2, cost: 0 } },
      ],
    ])

    const result = await runAgentLoop(
      [userMessage("question")],
      provider,
      [],
      "system",
      mockContext,
      createMockCallbacks(),
    )

    expect(result.messages).toHaveLength(2)
  })

  it("detects doom loops after repeated identical tool calls", async () => {
    const failTool: ToolDefinition = {
      name: "fail",
      description: "Always fails",
      parameters: z.object({ x: z.number() }),
      execute: async () => "failed",
      dangerous: false,
    }

    const provider = createMockProvider([
      [
        { type: "tool-call-start", toolCallId: "c1", toolName: "fail" },
        { type: "tool-call-end", toolCallId: "c1", toolName: "fail", args: { x: 1 } },
        { type: "finish", usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2, cost: 0 } },
      ],
      [
        { type: "tool-call-start", toolCallId: "c2", toolName: "fail" },
        { type: "tool-call-end", toolCallId: "c2", toolName: "fail", args: { x: 1 } },
        { type: "finish", usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2, cost: 0 } },
      ],
      [
        { type: "tool-call-start", toolCallId: "c3", toolName: "fail" },
        { type: "tool-call-end", toolCallId: "c3", toolName: "fail", args: { x: 1 } },
        { type: "finish", usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2, cost: 0 } },
      ],
    ])

    const result = await runAgentLoop(
      [userMessage("doom")],
      provider,
      [failTool],
      "system",
      mockContext,
      createMockCallbacks(),
    )

    expect(result.doomLoopDetected).toBe(true)
    const doomMsg = result.messages.find(
      (m) =>
        m.role === "assistant" &&
        m.content.some((c) => c.type === "text" && c.text.includes("Doom loop")),
    )
    expect(doomMsg).toBeDefined()
  })

  it("does not detect doom loop with different args", async () => {
    const echoTool: ToolDefinition = {
      name: "echo",
      description: "Echo",
      parameters: z.object({ input: z.string() }),
      execute: async (args) => String(args.input),
      dangerous: false,
    }

    const provider = createMockProvider([
      [
        { type: "tool-call-start", toolCallId: "c1", toolName: "echo" },
        { type: "tool-call-end", toolCallId: "c1", toolName: "echo", args: { input: "a" } },
        { type: "finish", usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2, cost: 0 } },
      ],
      [
        { type: "tool-call-start", toolCallId: "c2", toolName: "echo" },
        { type: "tool-call-end", toolCallId: "c2", toolName: "echo", args: { input: "b" } },
        { type: "finish", usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2, cost: 0 } },
      ],
      [
        { type: "tool-call-start", toolCallId: "c3", toolName: "echo" },
        { type: "tool-call-end", toolCallId: "c3", toolName: "echo", args: { input: "c" } },
        { type: "finish", usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2, cost: 0 } },
      ],
      [
        { type: "text-delta", text: "done" },
        { type: "finish", usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2, cost: 0 } },
      ],
    ])

    const result = await runAgentLoop(
      [userMessage("echo")],
      provider,
      [echoTool],
      "system",
      mockContext,
      createMockCallbacks(),
    )

    expect(result.doomLoopDetected).toBe(false)
  })

  it("calls onError when provider throws", async () => {
    const provider: Provider = {
      async *streamChat() {
        throw new Error("API error")
      },
      getModelInfo() {
        return { id: "mock", name: "Mock" }
      },
      async listModels() {
        return []
      },
    }

    let caughtError: unknown = null
    const result = await runAgentLoop(
      [userMessage("test")],
      provider,
      [],
      "system",
      mockContext,
      createMockCallbacks({ onError: (e) => (caughtError = e) }),
    )

    expect(caughtError).toBeInstanceOf(Error)
    expect((caughtError as Error).message).toBe("API error")
    expect(result.messages).toHaveLength(1)
  })

  it("respects abort signal", async () => {
    const controller = new AbortController()
    controller.abort()

    const provider = createMockProvider([
      [{ type: "text-delta", text: "should not see" }],
    ])

    const result = await runAgentLoop(
      [userMessage("test")],
      provider,
      [],
      "system",
      mockContext,
      createMockCallbacks(),
      controller.signal,
    )

    expect(result.messages).toHaveLength(1)
  })

  it("reports unknown tool as error result", async () => {
    const provider = createMockProvider([
      [
        { type: "tool-call-start", toolCallId: "c1", toolName: "nonexistent" },
        { type: "tool-call-end", toolCallId: "c1", toolName: "nonexistent", args: {} },
        { type: "finish", usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2, cost: 0 } },
      ],
      [
        { type: "text-delta", text: "done" },
        { type: "finish", usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2, cost: 0 } },
      ],
    ])

    const results: string[] = []
    await runAgentLoop(
      [userMessage("test")],
      provider,
      [],
      "system",
      mockContext,
      createMockCallbacks({
        onToolResult: (_, __, r) => results.push(r),
      }),
    )

    expect(results[0]).toContain("Unknown tool")
  })

  it("requests approval for dangerous tools", async () => {
    const bashTool: ToolDefinition = {
      name: "bash",
      description: "Run bash",
      parameters: z.object({ command: z.string() }),
      execute: async (args) => `ran: ${args.command}`,
      dangerous: true,
    }

    let approvalRequested = false
    const provider = createMockProvider([
      [
        { type: "tool-call-start", toolCallId: "c1", toolName: "bash" },
        { type: "tool-call-end", toolCallId: "c1", toolName: "bash", args: { command: "ls" } },
        { type: "finish", usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2, cost: 0 } },
      ],
      [
        { type: "text-delta", text: "done" },
        { type: "finish", usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2, cost: 0 } },
      ],
    ])

    await runAgentLoop(
      [userMessage("run ls")],
      provider,
      [bashTool],
      "system",
      mockContext,
      createMockCallbacks({
        requestApproval: async () => {
          approvalRequested = true
          return true
        },
      }),
    )

    expect(approvalRequested).toBe(true)
  })

  it("sends rejection message back to LLM when approval denied", async () => {
    const bashTool: ToolDefinition = {
      name: "bash",
      description: "Run bash",
      parameters: z.object({ command: z.string() }),
      execute: async () => "should not run",
      dangerous: true,
    }

    const provider = createMockProvider([
      [
        { type: "tool-call-start", toolCallId: "c1", toolName: "bash" },
        { type: "tool-call-end", toolCallId: "c1", toolName: "bash", args: { command: "rm -rf /" } },
        { type: "finish", usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2, cost: 0 } },
      ],
      [
        { type: "text-delta", text: "Ok, I won't do that" },
        { type: "finish", usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2, cost: 0 } },
      ],
    ])

    const result = await runAgentLoop(
      [userMessage("delete everything")],
      provider,
      [bashTool],
      "system",
      mockContext,
      createMockCallbacks({ requestApproval: async () => false }),
    )

    const toolMsg = result.messages.find((m) => m.role === "tool")
    expect(toolMsg).toBeDefined()
    if (toolMsg) {
      const content = toolMsg.content[0]
      expect(content).toBeDefined()
      if (content && content.type === "tool-result") {
        expect(content.result).toBe("User rejected this tool call.")
      }
    }
  })

  it("handles tool execution errors gracefully", async () => {
    const brokenTool: ToolDefinition = {
      name: "broken",
      description: "Broken tool",
      parameters: z.object({}),
      execute: async () => {
        throw new Error("tool broke")
      },
      dangerous: false,
    }

    const provider = createMockProvider([
      [
        { type: "tool-call-start", toolCallId: "c1", toolName: "broken" },
        { type: "tool-call-end", toolCallId: "c1", toolName: "broken", args: {} },
        { type: "finish", usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2, cost: 0 } },
      ],
      [
        { type: "text-delta", text: "recovered" },
        { type: "finish", usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2, cost: 0 } },
      ],
    ])

    const results: string[] = []
    await runAgentLoop(
      [userMessage("try")],
      provider,
      [brokenTool],
      "system",
      mockContext,
      createMockCallbacks({
        onToolResult: (_, __, r) => results.push(r),
      }),
    )

    expect(results[0]).toContain("tool broke")
  })

  it("accumulates usage across multiple loop iterations", async () => {
    const echoTool: ToolDefinition = {
      name: "echo",
      description: "Echo",
      parameters: z.object({ x: z.string() }),
      execute: async (args) => String(args.x),
      dangerous: false,
    }

    const provider = createMockProvider([
      [
        { type: "tool-call-start", toolCallId: "c1", toolName: "echo" },
        { type: "tool-call-end", toolCallId: "c1", toolName: "echo", args: { x: "1" } },
        { type: "finish", usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15, cost: 0 } },
      ],
      [
        { type: "tool-call-start", toolCallId: "c2", toolName: "echo" },
        { type: "tool-call-end", toolCallId: "c2", toolName: "echo", args: { x: "2" } },
        { type: "finish", usage: { inputTokens: 8, outputTokens: 4, totalTokens: 12, cost: 0 } },
      ],
      [
        { type: "text-delta", text: "done" },
        { type: "finish", usage: { inputTokens: 5, outputTokens: 2, totalTokens: 7, cost: 0 } },
      ],
    ])

    const result = await runAgentLoop(
      [userMessage("echo")],
      provider,
      [echoTool],
      "system",
      mockContext,
      createMockCallbacks(),
    )

    expect(result.totalUsage).toEqual({
      inputTokens: 23,
      outputTokens: 11,
      totalTokens: 34,
      cost: 0,
    })
  })

  it("accumulates cost across multiple loop iterations", async () => {
    const echoTool: ToolDefinition = {
      name: "echo",
      description: "Echo",
      parameters: z.object({ x: z.string() }),
      execute: async (args) => String(args.x),
      dangerous: false,
    }

    const provider = createMockProvider([
      [
        { type: "tool-call-start", toolCallId: "c1", toolName: "echo" },
        { type: "tool-call-end", toolCallId: "c1", toolName: "echo", args: { x: "1" } },
        { type: "finish", usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15, cost: 0.01 } },
      ],
      [
        { type: "tool-call-start", toolCallId: "c2", toolName: "echo" },
        { type: "tool-call-end", toolCallId: "c2", toolName: "echo", args: { x: "2" } },
        { type: "finish", usage: { inputTokens: 8, outputTokens: 4, totalTokens: 12, cost: 0.02 } },
      ],
      [
        { type: "text-delta", text: "done" },
        { type: "finish", usage: { inputTokens: 5, outputTokens: 2, totalTokens: 7, cost: 0.03 } },
      ],
    ])

    const result = await runAgentLoop(
      [userMessage("echo")],
      provider,
      [echoTool],
      "system",
      mockContext,
      createMockCallbacks(),
    )

    expect(result.totalUsage.cost).toBeCloseTo(0.06, 4)
  })

  describe("per-call approval policy", () => {
    function makePolicyTool(overrides: Partial<ToolDefinition>): ToolDefinition {
      return {
        name: "touch",
        description: "Touch a file",
        parameters: z.object({ path: z.string() }),
        dangerous: true,
        execute: async () => "done",
        ...overrides,
      }
    }

    function policyProvider(): Provider {
      return createMockProvider([
        [
          { type: "tool-call-start", toolCallId: "c1", toolName: "touch" },
          { type: "tool-call-end", toolCallId: "c1", toolName: "touch", args: { path: "a.txt" } },
          { type: "finish", usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2, cost: 0 } },
        ],
      ])
    }

    it("auto-approves a call when requiresApproval returns false despite dangerous flag", async () => {
      const approvals: string[] = []
      const tool = makePolicyTool({ requiresApproval: () => false })
      const result = await runAgentLoop(
        [userMessage("go")],
        policyProvider(),
        [tool],
        "system",
        mockContext,
        createMockCallbacks({ requestApproval: async (name) => { approvals.push(name); return true } }),
      )
      expect(approvals).toEqual([])
      const toolMsg = result.messages.find((m) => m.role === "tool")
      expect((toolMsg!.content[0] as { result: string }).result).toBe("done")
    })

    it("pauses for approval when requiresApproval returns true despite non-dangerous flag", async () => {
      const approvals: string[] = []
      const tool = makePolicyTool({ dangerous: false, requiresApproval: () => true })
      await runAgentLoop(
        [userMessage("go")],
        policyProvider(),
        [tool],
        "system",
        mockContext,
        createMockCallbacks({ requestApproval: async (name) => { approvals.push(name); return true } }),
      )
      expect(approvals).toEqual(["touch"])
    })

    it("reports rejection when requiresApproval pauses and user rejects", async () => {
      const tool = makePolicyTool({ dangerous: false, requiresApproval: () => true })
      const result = await runAgentLoop(
        [userMessage("go")],
        policyProvider(),
        [tool],
        "system",
        mockContext,
        createMockCallbacks({ requestApproval: async () => false }),
      )
      const toolMsg = result.messages.find((m) => m.role === "tool")
      expect((toolMsg!.content[0] as { result: string }).result).toBe("User rejected this tool call.")
    })

    it("falls back to the dangerous flag when requiresApproval is absent", async () => {
      const approvals: string[] = []
      const tool = makePolicyTool({})
      await runAgentLoop(
        [userMessage("go")],
        policyProvider(),
        [tool],
        "system",
        mockContext,
        createMockCallbacks({ requestApproval: async (name) => { approvals.push(name); return true } }),
      )
      expect(approvals).toEqual(["touch"])
    })
  })

  describe("real tools through the loop", () => {
    function toolCallProvider(toolName: string, args: Record<string, unknown>): Provider {
      return createMockProvider([
        [
          { type: "tool-call-start", toolCallId: "c1", toolName },
          { type: "tool-call-end", toolCallId: "c1", toolName, args },
          { type: "finish", usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2, cost: 0 } },
        ],
      ])
    }

    it("executes a normal write_file silently with no approval", async () => {
      const approvals: string[] = []
      await runAgentLoop(
        [userMessage("write")],
        toolCallProvider("write_file", { path: "notes.txt", content: "hello" }),
        [writeFileTool],
        "system",
        { projectPath: realToolsDir },
        createMockCallbacks({ requestApproval: async (name) => { approvals.push(name); return true } }),
      )
      expect(approvals).toEqual([])
      expect(readFileSync(join(realToolsDir, "notes.txt"), "utf-8")).toBe("hello")
    })

    it("pauses for approval on a .env write and rejection leaves the file untouched", async () => {
      writeFileSync(join(realToolsDir, ".env"), "ORIGINAL=1")
      const approvals: string[] = []
      const result = await runAgentLoop(
        [userMessage("write env")],
        toolCallProvider("write_file", { path: ".env", content: "HACKED=1" }),
        [writeFileTool],
        "system",
        { projectPath: realToolsDir },
        createMockCallbacks({ requestApproval: async (name) => { approvals.push(name); return false } }),
      )
      expect(approvals).toEqual(["write_file"])
      const toolMsg = result.messages.find((m) => m.role === "tool")
      expect((toolMsg!.content[0] as { result: string }).result).toBe("User rejected this tool call.")
      expect(readFileSync(join(realToolsDir, ".env"), "utf-8")).toBe("ORIGINAL=1")
    })

    it("always asks for approval before bash runs", async () => {
      const approvals: string[] = []
      await runAgentLoop(
        [userMessage("run")],
        toolCallProvider("bash", { command: "echo hi" }),
        [bashTool],
        "system",
        { projectPath: realToolsDir },
        createMockCallbacks({
          requestApproval: async (name) => { approvals.push(name); return true },
          onTextDelta: () => {},
        }),
      )
      expect(approvals).toEqual(["bash"])
    })
  })
})
