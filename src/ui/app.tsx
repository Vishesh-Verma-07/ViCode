import React, { useState, useCallback, useRef } from "react"
import { Box, Text, useInput, useApp, useWindowSize } from "ink"
import { TextInput } from "@inkjs/ui"
import type { Message, ToolDefinition, ToolContext } from "../core/types"
import type { Provider, TokenUsage } from "../core/provider"
import { runAgentLoop } from "../core/agent-loop"

interface ToolCallEntry {
  id: string
  name: string
  args: Record<string, unknown>
  result?: string
}

interface AppProps {
  provider: Provider
  tools: ToolDefinition[]
  systemPrompt: string
  context: ToolContext
}

export function App({ provider, tools, systemPrompt, context }: AppProps) {
  const [messages, setMessages] = useState<Message[]>([])
  const [isStreaming, setIsStreaming] = useState(false)
  const [currentText, setCurrentText] = useState("")
  const [toolCalls, setToolCalls] = useState<ToolCallEntry[]>([])
  const [usage, setUsage] = useState<TokenUsage>({ inputTokens: 0, outputTokens: 0, totalTokens: 0 })
  const abortRef = useRef<AbortController | null>(null)
  const { exit } = useApp()
  const { columns, rows } = useWindowSize()

  const handleSend = useCallback(
    async (input: string) => {
      if (!input.trim() || isStreaming) return

      const userMsg: Message = {
        id: `user_${Date.now()}`,
        role: "user",
        content: [{ type: "text", text: input }],
        timestamp: Date.now(),
      }

      setMessages((prev) => [...prev, userMsg])
      setCurrentText("")
      setToolCalls([])
      setIsStreaming(true)

      const controller = new AbortController()
      abortRef.current = controller

      try {
        const result = await runAgentLoop(
          [...messages, userMsg],
          provider,
          tools,
          systemPrompt,
          context,
          {
            onTextDelta: (text) => {
              setCurrentText((prev) => prev + text)
            },
            onToolCallStart: (id, name) => {
              setToolCalls((prev) => [
                ...prev,
                { id, name, args: {} },
              ])
            },
            onToolCallDelta: () => {},
            onToolCallEnd: (id, _name, args) => {
              setToolCalls((prev) =>
                prev.map((tc) =>
                  tc.id === id ? { ...tc, args } : tc,
                ),
              )
            },
            onToolResult: (id, _name, result) => {
              setToolCalls((prev) =>
                prev.map((tc) =>
                  tc.id === id ? { ...tc, result } : tc,
                ),
              )
            },
            onError: (error) => {
              console.error("Agent error:", error)
            },
            requestApproval: async () => true,
          },
          controller.signal,
        )

        setMessages(result.messages)
        setUsage(result.totalUsage)
      } catch (error) {
        if (error instanceof Error && error.name !== "AbortError") {
          console.error("Loop error:", error)
        }
      } finally {
        setCurrentText("")
        setIsStreaming(false)
        abortRef.current = null
      }
    },
    [messages, provider, tools, systemPrompt, context, isStreaming],
  )

  useInput(
    (input, key) => {
      if (key.escape && isStreaming && abortRef.current) {
        abortRef.current.abort()
      }
      if (key.ctrl && input === "c") {
        exit()
      }
    },
    { isActive: true },
  )

  const sidebarWidth = Math.max(30, Math.floor(columns * 0.3))
  const chatWidth = columns - sidebarWidth - 1

  return (
    <Box flexDirection="column" width={columns} height={rows}>
      <Box flexDirection="row" flexGrow={1}>
        <ChatPanel
          width={chatWidth}
          messages={messages}
          currentText={currentText}
          isStreaming={isStreaming}
          onSend={handleSend}
        />
        <Sidebar width={sidebarWidth} toolCalls={toolCalls} />
      </Box>
      <StatusBar usage={usage} model={provider.getModelInfo().name} />
    </Box>
  )
}

interface ChatPanelProps {
  width: number
  messages: Message[]
  currentText: string
  isStreaming: boolean
  onSend: (input: string) => void
}

function ChatPanel({ width, messages, currentText, isStreaming, onSend }: ChatPanelProps) {
  return (
    <Box
      width={width}
      flexDirection="column"
      borderStyle="single"
      borderColor="gray"
      paddingX={1}
    >
      <Box flexGrow={1} flexDirection="column" overflow="hidden">
        {messages.length === 0 && (
          <Text color="gray" italic>
            Type a message to start chatting...
          </Text>
        )}
        {messages.map((msg) => (
          <MessageBubble key={msg.id} message={msg} />
        ))}
        {isStreaming && currentText && (
          <Text>{currentText}</Text>
        )}
        {isStreaming && !currentText && (
          <Text color="yellow">Thinking...</Text>
        )}
      </Box>
      <Box borderTop={true} borderTopColor="gray" paddingTop={1}>
        <TextInput
          placeholder={isStreaming ? "Waiting for response..." : "Type your message..."}
          isDisabled={isStreaming}
          onSubmit={onSend}
        />
      </Box>
    </Box>
  )
}

interface MessageBubbleProps {
  message: Message
}

function MessageBubble({ message }: MessageBubbleProps) {
  if (message.role === "user") {
    const text = message.content
      .filter((c) => c.type === "text")
      .map((c) => (c.type === "text" ? c.text : ""))
      .join("")
    return (
      <Box marginBottom={1}>
        <Text color="blue" bold>
          You:{" "}
        </Text>
        <Text>{text}</Text>
      </Box>
    )
  }

  if (message.role === "assistant") {
    const text = message.content
      .filter((c) => c.type === "text")
      .map((c) => (c.type === "text" ? c.text : ""))
      .join("")
    if (!text) return null
    return (
      <Box marginBottom={1}>
        <Text color="green" bold>
          AI:{" "}
        </Text>
        <Text>{text}</Text>
      </Box>
    )
  }

  return null
}

interface SidebarProps {
  width: number
  toolCalls: ToolCallEntry[]
}

function Sidebar({ width, toolCalls }: SidebarProps) {
  return (
    <Box
      width={width}
      flexDirection="column"
      borderStyle="single"
      borderColor="gray"
      paddingX={1}
    >
      <Text color="cyan" bold>
        Tools
      </Text>
      {toolCalls.length === 0 && (
        <Text color="gray" italic>
          No tool calls yet
        </Text>
      )}
      {toolCalls.map((tc) => (
        <Box key={tc.id} flexDirection="column" marginBottom={1}>
          <Text color="yellow">
            {tc.name}
          </Text>
          {tc.result && (
            <Text color="gray" wrap="wrap">
              {tc.result.length > 200
                ? tc.result.slice(0, 200) + "..."
                : tc.result}
            </Text>
          )}
        </Box>
      ))}
    </Box>
  )
}

interface StatusBarProps {
  usage: TokenUsage
  model: string
}

function StatusBar({ usage, model }: StatusBarProps) {
  return (
    <Box
      justifyContent="space-between"
      paddingX={1}
      borderStyle="single"
      borderColor="gray"
    >
      <Text color="gray">
        {model}
      </Text>
      <Text color="gray">
        Tokens: {usage.totalTokens}
      </Text>
    </Box>
  )
}
