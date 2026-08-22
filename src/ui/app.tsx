import React, { useState, useCallback, useEffect, useRef, useMemo } from "react"
import { Box, Text, useInput, useApp, useWindowSize } from "ink"
import { TextInput } from "@inkjs/ui"
import type { Message, ToolDefinition, ToolContext, Command, CommandContext, PickerRequest } from "../core/types"
import type { Session } from "../core/session"
import type { Provider, TokenUsage } from "../core/provider"
import { DIFF_START_MARKER, DIFF_END_MARKER } from "../core/constants"
import { runAgentLoop } from "../core/agent-loop"
import { CommandRegistry } from "../core/command-registry"
import { dispatchCommand, getCommandName, isCommandAttempt } from "../core/command-dispatcher"
import { createSession, saveSession } from "../core/session"
import { formatCost, formatTokens } from "../core/cost-calculator"
import { Picker } from "./picker"
import { CommandSuggestion, filterCommands, moveHighlight, type CommandSuggestionProps } from "./command-suggestion"
import { log } from "../utils/logger"

interface ToolCallEntry {
  id: string
  name: string
  args: Record<string, unknown>
  result?: string
}

interface DiffEntry {
  id: string
  filePath: string
  diff: string
  timestamp: number
}

type SidebarTab = "tools" | "diffs"

export type FeedbackTone = "info" | "error"

export interface FeedbackEntry {
  id: string
  text: string
  tone: FeedbackTone
}

interface PendingApproval {
  toolName: string
  args: Record<string, unknown>
  resolve: (approved: boolean) => void
}

export const STREAMING_COMMAND_NOTICE = "Still responding - press Esc to stop it, or /exit to quit."

interface AppProps {
  provider: Provider
  createProvider?: (modelId: string) => Provider
  tools: ToolDefinition[]
  systemPrompt: string
  context: ToolContext
  initialSession?: Session
  sessionsDir?: string
  commands?: Command[]
}

export function extractDiff(result: string): { message: string; diff: string | null } {
  const startIdx = result.indexOf(DIFF_START_MARKER)
  const endIdx = result.indexOf(DIFF_END_MARKER)
  if (startIdx === -1 || endIdx === -1) {
    return { message: result, diff: null }
  }
  const message = result.slice(0, startIdx).trimEnd()
  const diff = result.slice(startIdx + DIFF_START_MARKER.length, endIdx).replace(/^\n/, "")
  return { message, diff }
}

export function App({ provider, createProvider, tools, systemPrompt, context, initialSession, sessionsDir, commands }: AppProps) {
  const [messages, setMessages] = useState<Message[]>(initialSession?.messages ?? [])
  const [session, setSession] = useState<Session | null>(initialSession ?? null)
  const [providerState, setProviderState] = useState<Provider>(provider)
  const [isStreaming, setIsStreaming] = useState(false)
  const [currentText, setCurrentText] = useState("")
  const [toolCalls, setToolCalls] = useState<ToolCallEntry[]>([])
  const [diffs, setDiffs] = useState<DiffEntry[]>([])
  const [activeTab, setActiveTab] = useState<SidebarTab>("tools")
  const [usage, setUsage] = useState<TokenUsage>({ inputTokens: 0, outputTokens: 0, totalTokens: 0, cost: 0 })
  const [pendingApproval, setPendingApproval] = useState<PendingApproval | null>(null)
  const [showExitSummary, setShowExitSummary] = useState(false)
  const [feedbackEntries, setFeedbackEntries] = useState<FeedbackEntry[]>([])
  const [inputKey, setInputKey] = useState(0)
  const [pickerRequest, setPickerRequest] = useState<PickerRequest | null>(null)
  const [inputValue, setInputValue] = useState("")
  const [suggestionDismissed, setSuggestionDismissed] = useState(false)
  const [suggestionHighlight, setSuggestionHighlight] = useState(0)
  const abortRef = useRef<AbortController | null>(null)
  const activeTurnRef = useRef<Promise<void> | null>(null)
  const { exit } = useApp()
  const { columns, rows } = useWindowSize()

  const commandRegistry = useMemo(() => {
    const registry = new CommandRegistry()
    if (commands) registry.registerAll(commands)
    return registry
  }, [commands])

  const appendFeedback = useCallback((text: string, tone: FeedbackTone) => {
    setFeedbackEntries((prev) => [
      ...prev,
      { id: `feedback_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`, text, tone },
    ])
  }, [])

  const allCommands = commandRegistry.getAll()
  const firstWord = inputValue.trim().split(/\s+/)[0] ?? ""
  const suggestedCommands = firstWord.startsWith("/") ? filterCommands(allCommands, firstWord) : []
  const suggestionVisible =
    !isStreaming &&
    !pickerRequest &&
    !pendingApproval &&
    !showExitSummary &&
    firstWord.startsWith("/") &&
    !suggestionDismissed
  const clampedSuggestionHighlight = Math.min(suggestionHighlight, Math.max(0, suggestedCommands.length - 1))

  const handleInputChange = useCallback((value: string) => {
    setInputValue(value)
    setSuggestionDismissed(false)
    setSuggestionHighlight(0)
  }, [])

  const pickerResolveRef = useRef<((index: number | null) => void) | null>(null)

  const openPicker = useCallback((request: PickerRequest) => {
    return new Promise<number | null>((resolve) => {
      pickerResolveRef.current = resolve
      setPickerRequest(request)
    })
  }, [])

  const closePicker = useCallback((index: number | null) => {
    pickerResolveRef.current?.(index)
    pickerResolveRef.current = null
    setPickerRequest(null)
  }, [])

  useEffect(() => {
    return () => {
      pickerResolveRef.current?.(null)
      pickerResolveRef.current = null
    }
  }, [])

  const performExit = useCallback(async () => {
    abortRef.current?.abort()
    const turn = activeTurnRef.current
    if (turn) {
      try {
        await turn
      } catch {
        // The turn already reports its own errors; never let one block exiting.
      }
    }
    exit()
  }, [exit])

  const handleSend = useCallback(
    async (input: string) => {
      if (!input.trim()) return

      if (isStreaming) {
        if (!isCommandAttempt(input)) return
        if (getCommandName(input) !== "exit") {
          appendFeedback(STREAMING_COMMAND_NOTICE, "info")
          return
        }
      }

      setCurrentText("")
      setInputKey((prev) => prev + 1)
      setInputValue("")
      setSuggestionDismissed(false)
      setSuggestionHighlight(0)

      const commandContext: CommandContext = {
        projectPath: context.projectPath,
        openPicker,
        sessions: sessionsDir
          ? {
              dir: sessionsDir,
              getActiveSession: () => session,
              switchTo: (loaded) => {
                setSession(loaded)
                setMessages(loaded.messages)
              },
              startFresh: () => {
                setSession(null)
                setMessages([])
                setToolCalls([])
                setDiffs([])
                setUsage({ inputTokens: 0, outputTokens: 0, totalTokens: 0, cost: 0 })
              },
            }
          : undefined,
        exit: {
          requestExit: () => performExit(),
        },
        models: createProvider
          ? {
              list: () => providerState.listModels(),
              getCurrentModelId: () => providerState.getModelInfo().id,
              switchTo: (modelId) => setProviderState(createProvider(modelId)),
            }
          : undefined,
      }
      const dispatch = await dispatchCommand(input, commandRegistry, commandContext)

      if (dispatch.kind !== "pass-through") {
        if (dispatch.kind === "executed") {
          if (dispatch.output) appendFeedback(dispatch.output, "info")
        } else {
          appendFeedback(dispatch.error, "error")
        }
        return
      }

      const userMsg: Message = {
        id: `user_${Date.now()}`,
        role: "user",
        content: [{ type: "text", text: input }],
        timestamp: Date.now(),
      }

      setMessages((prev) => [...prev, userMsg])
      setToolCalls([])
      setDiffs([])
      setIsStreaming(true)

      const controller = new AbortController()
      abortRef.current = controller

      const turn = (async () => {
        try {
          const result = await runAgentLoop(
            [...messages, userMsg],
            providerState,
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
                const { message, diff } = extractDiff(result)
                setToolCalls((prev) =>
                  prev.map((tc) =>
                    tc.id === id ? { ...tc, result: message } : tc,
                  ),
                )
                if (diff) {
                  const toolCall = toolCalls.find((tc) => tc.id === id)
                  const filePath = toolCall?.args?.path as string ?? "unknown"
                  setDiffs((prev) => [
                    ...prev,
                    { id, filePath, diff, timestamp: Date.now() },
                  ])
                }
              },
              onError: (error) => {
                console.error("Agent error:", error)
              },
              requestApproval: (toolName, args) => {
                return new Promise<boolean>((resolve) => {
                  setPendingApproval({ toolName, args, resolve })
                })
              },
            },
            controller.signal,
          )

          log(result)

          setMessages(result.messages)
          setUsage((prev) => ({
            inputTokens: prev.inputTokens + result.totalUsage.inputTokens,
            outputTokens: prev.outputTokens + result.totalUsage.outputTokens,
            totalTokens: prev.totalTokens + result.totalUsage.totalTokens,
            cost: prev.cost + result.totalUsage.cost,
          }))

          if (sessionsDir) {
            const activeSession = session ?? createSession({
              projectPath: context.projectPath,
              model: providerState.getModelInfo().name,
              messages: result.messages,
            })
            const savedSession: Session = {
              ...activeSession,
              messages: result.messages,
              model: providerState.getModelInfo().name,
              updatedAt: new Date().toISOString(),
              totalTokens: activeSession.totalTokens + result.totalUsage.totalTokens,
              totalCost: activeSession.totalCost + result.totalUsage.cost,
            }
            saveSession(savedSession, sessionsDir)
            setSession(savedSession)
          }
        } catch (error) {
          if (error instanceof Error && error.name !== "AbortError") {
            console.error("Loop error:", error)
          }
        } finally {
          setCurrentText("")
          setIsStreaming(false)
          abortRef.current = null
        }
      })()
      activeTurnRef.current = turn
      try {
        await turn
      } finally {
        if (activeTurnRef.current === turn) activeTurnRef.current = null
      }
    },
    [messages, providerState, createProvider, tools, systemPrompt, context, isStreaming, toolCalls, session, sessionsDir, commandRegistry, appendFeedback, openPicker, performExit],
  )

  useInput(
    (input, key) => {
      if (pickerRequest) return

      if (pendingApproval) {
        const lower = input.toLowerCase()
        if (lower === "y" || lower === "n") {
          pendingApproval.resolve(lower === "y")
          setPendingApproval(null)
        }
        return
      }

      if (showExitSummary) {
        exit()
        return
      }

      if (suggestionVisible) {
        if (key.upArrow) {
          setSuggestionHighlight((prev) => moveHighlight(prev, suggestedCommands.length, -1))
          return
        }
        if (key.downArrow) {
          setSuggestionHighlight((prev) => moveHighlight(prev, suggestedCommands.length, 1))
          return
        }
        if (key.escape) {
          setSuggestionDismissed(true)
          return
        }
      }

      if (key.return) {
        const suggestedCommand = suggestionVisible ? suggestedCommands[clampedSuggestionHighlight] : undefined
        if (suggestedCommand) {
          const typedRest = inputValue.trim().slice(firstWord.length)
          void handleSend(`/${suggestedCommand.name}${typedRest}`)
        } else if (inputValue.trim()) {
          void handleSend(inputValue)
        }
        return
      }

      if (key.tab) {
        setActiveTab((prev) => (prev === "tools" ? "diffs" : "tools"))
        return
      }

      if (key.escape && isStreaming && abortRef.current) {
        abortRef.current.abort()
      }
      if (key.ctrl && input === "c") {
        setShowExitSummary(true)
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
          feedbackEntries={feedbackEntries}
          inputKey={inputKey}
          inputDisabled={pickerRequest !== null}
          onInputChange={handleInputChange}
          suggestion={suggestionVisible ? { items: suggestedCommands, highlightIndex: clampedSuggestionHighlight } : undefined}
        />
        <Sidebar
          width={sidebarWidth}
          activeTab={activeTab}
          toolCalls={toolCalls}
          diffs={diffs}
        />
      </Box>
      <StatusBar usage={usage} model={providerState.getModelInfo().name} />
      {pickerRequest && (
        <Picker
          title={pickerRequest.title}
          items={pickerRequest.items}
          onSelect={(index) => closePicker(index)}
          onCancel={() => closePicker(null)}
        />
      )}
      {pendingApproval && (
        <ApprovalPrompt
          toolName={pendingApproval.toolName}
          args={pendingApproval.args}
        />
      )}
      {showExitSummary && (
        <ExitSummary usage={usage} model={providerState.getModelInfo().name} />
      )}
    </Box>
  )
}

interface ChatPanelProps {
  width: number
  messages: Message[]
  currentText: string
  isStreaming: boolean
  onSend: (input: string) => void
  feedbackEntries: FeedbackEntry[]
  inputKey: number
  inputDisabled?: boolean
  onInputChange?: (value: string) => void
  suggestion?: CommandSuggestionProps
}

function ChatPanel({ width, messages, currentText, isStreaming, onSend, feedbackEntries, inputKey, inputDisabled, onInputChange, suggestion }: ChatPanelProps) {
  return (
    <Box
      width={width}
      flexDirection="column"
      borderStyle="single"
      borderColor="gray"
      paddingX={1}
    >
      <Box flexGrow={1} flexDirection="column" overflow="hidden">
        {messages.length === 0 && feedbackEntries.length === 0 && (
          <Text color="gray" italic>
            Type a message to start chatting...
          </Text>
        )}
        {messages.map((msg) => (
          <MessageBubble key={msg.id} message={msg} />
        ))}
        {feedbackEntries.map((entry) => (
          <FeedbackLine key={entry.id} text={entry.text} tone={entry.tone} />
        ))}
        {isStreaming && currentText && (
          <Text>{currentText}</Text>
        )}
        {isStreaming && !currentText && (
          <Text color="yellow">Thinking...</Text>
        )}
      </Box>
      {suggestion && (
        <Box paddingBottom={1}>
          <CommandSuggestion
            items={suggestion.items}
            highlightIndex={suggestion.highlightIndex}
          />
        </Box>
      )}
      <Box borderTop={true} borderTopColor="gray" paddingTop={1}>
        <TextInput
          key={inputKey}
          placeholder={isStreaming ? "Responding - /exit to quit" : "Type your message..."}
          isDisabled={inputDisabled}
          onChange={onInputChange}
        />
      </Box>
    </Box>
  )
}

interface MessageBubbleProps {
  message: Message
}

export function FeedbackLine({ text, tone }: { text: string; tone: FeedbackTone }) {
  return (
    <Box marginBottom={1}>
      <Text color={tone === "error" ? "red" : "cyan"} wrap="wrap">
        {text}
      </Text>
    </Box>
  )
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
  activeTab: SidebarTab
  toolCalls: ToolCallEntry[]
  diffs: DiffEntry[]
}

function Sidebar({ width, activeTab, toolCalls, diffs }: SidebarProps) {
  return (
    <Box
      width={width}
      flexDirection="column"
      borderStyle="single"
      borderColor="gray"
      paddingX={1}
    >
      <Box>
        <Text
          color={activeTab === "tools" ? "cyan" : "gray"}
          bold={activeTab === "tools"}
        >
          Tools
        </Text>
        <Text color="gray"> | </Text>
        <Text
          color={activeTab === "diffs" ? "cyan" : "gray"}
          bold={activeTab === "diffs"}
        >
          Diffs{diffs.length > 0 ? ` (${diffs.length})` : ""}
        </Text>
      </Box>
      {activeTab === "tools" && (
        <ToolsTab toolCalls={toolCalls} />
      )}
      {activeTab === "diffs" && (
        <DiffsTab diffs={diffs} />
      )}
    </Box>
  )
}

function ToolsTab({ toolCalls }: { toolCalls: ToolCallEntry[] }) {
  if (toolCalls.length === 0) {
    return (
      <Text color="gray" italic>
        No tool calls yet
      </Text>
    )
  }
  return (
    <Box flexDirection="column">
      {toolCalls.map((tc) => {
        const argsStr = Object.keys(tc.args).length > 0
          ? JSON.stringify(tc.args)
          : ""
        const maxLines = 500
        const resultDisplay = tc.result
          ? truncateLines(tc.result, maxLines)
          : ""
        return (
          <Box key={tc.id} flexDirection="column" marginBottom={1}>
            <Text color="yellow">
              {tc.name}
            </Text>
            {argsStr && (
              <Text color="gray" wrap="wrap">
                {argsStr}
              </Text>
            )}
            {resultDisplay && (
              <Text color="gray" wrap="wrap">
                {resultDisplay}
              </Text>
            )}
          </Box>
        )
      })}
    </Box>
  )
}

function DiffsTab({ diffs }: { diffs: DiffEntry[] }) {
  if (diffs.length === 0) {
    return (
      <Text color="gray" italic>
        No diffs yet
      </Text>
    )
  }
  return (
    <Box flexDirection="column">
      {diffs.map((entry) => (
        <DiffView key={entry.id} filePath={entry.filePath} diff={entry.diff} />
      ))}
    </Box>
  )
}

function DiffView({ filePath, diff }: { filePath: string; diff: string }) {
  const lines = diff.split("\n")
  return (
    <Box flexDirection="column" marginBottom={1}>
      <Text color="blue" bold>
        {filePath}
      </Text>
      {lines.map((line, i) => {
        if (line.startsWith("+") && !line.startsWith("+++")) {
          return <Text key={i} color="green">{line}</Text>
        }
        if (line.startsWith("-") && !line.startsWith("---")) {
          return <Text key={i} color="red">{line}</Text>
        }
        if (line.startsWith("@@")) {
          return <Text key={i} color="cyan">{line}</Text>
        }
        return <Text key={i}>{line}</Text>
      })}
    </Box>
  )
}

function truncateLines(text: string, maxLines: number): string {
  const lines = text.split("\n")
  if (lines.length <= maxLines) return text
  const truncated = lines.slice(0, maxLines).join("\n")
  return truncated + `\n... (${lines.length - maxLines} more lines)`
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
        Tokens: {formatTokens(usage.totalTokens)} | Cost: {formatCost(usage.cost)}
      </Text>
    </Box>
  )
}

interface ApprovalPromptProps {
  toolName: string
  args: Record<string, unknown>
}

function ApprovalPrompt({ toolName, args }: ApprovalPromptProps) {
  const argsStr = Object.keys(args).length > 0
    ? JSON.stringify(args, null, 2)
    : ""

  return (
    <Box
      flexDirection="column"
      borderStyle="double"
      borderColor="yellow"
      paddingX={1}
      paddingY={1}
    >
      <Text color="yellow" bold>
        ⚠ Tool Approval Required
      </Text>
      <Box marginTop={1}>
        <Text color="white" bold>
          Tool:{" "}
        </Text>
        <Text color="cyan">{toolName}</Text>
      </Box>
      {argsStr && (
        <Box marginTop={1}>
          <Text color="white" bold>
            Args:{" "}
          </Text>
          <Text color="gray" wrap="wrap">{argsStr}</Text>
        </Box>
      )}
      <Box marginTop={1}>
        <Text color="green">[y]</Text>
        <Text color="gray"> Approve </Text>
        <Text color="red">[n]</Text>
        <Text color="gray"> Reject</Text>
      </Box>
    </Box>
  )
}

interface ExitSummaryProps {
  usage: TokenUsage
  model: string
}

function ExitSummary({ usage, model }: ExitSummaryProps) {
  return (
    <Box
      flexDirection="column"
      borderStyle="double"
      borderColor="cyan"
      paddingX={1}
      paddingY={1}
    >
      <Text color="cyan" bold>
        Session Summary
      </Text>
      <Box marginTop={1}>
        <Text color="white" bold>
          Model:{" "}
        </Text>
        <Text color="gray">{model}</Text>
      </Box>
      <Box marginTop={1}>
        <Text color="white" bold>
          Tokens:{" "}
        </Text>
        <Text color="gray">
          {formatTokens(usage.totalTokens)} total ({formatTokens(usage.inputTokens)} in / {formatTokens(usage.outputTokens)} out)
        </Text>
      </Box>
      <Box marginTop={1}>
        <Text color="white" bold>
          Cost:{" "}
        </Text>
        <Text color="green">{formatCost(usage.cost)}</Text>
      </Box>
      <Box marginTop={1}>
        <Text color="gray" italic>
          Press any key to exit
        </Text>
      </Box>
    </Box>
  )
}
