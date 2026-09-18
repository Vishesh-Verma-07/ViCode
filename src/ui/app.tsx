import { useEffect, useMemo, useState } from "react"
import { Box, useApp, useInput, useStdout, useWindowSize } from "ink"
import { MOUSE_TRACKING_ENABLE, MOUSE_TRACKING_DISABLE } from "./mouse"
import { COLORS } from "./theme"
import type { Command, ToolContext, ToolDefinition } from "../core/types"
import type { Session } from "../core/session"
import type { Provider } from "../core/provider"
import { CommandRegistry } from "../core/command-registry"
import { filterCommands, moveHighlight } from "./command-suggestion"
import { Picker } from "./picker"
import { WelcomeScreen } from "./welcome"
import { ChatPanel, CHAT_CHROME_LINES } from "./chat-panel"
import { UsagePanel } from "./usage-panel"
import { StatusBar } from "./status-bar"
import { ApprovalPrompt } from "./approval-prompt"
import { ExitSummary } from "./exit-summary"
import { useChatDrafting } from "./use-chat-drafting"
import { useAgentSession } from "./use-agent-session"

export { STREAMING_COMMAND_NOTICE } from "./use-agent-session"
export type { FeedbackTone, FeedbackEntry } from "./feedback-line"
export { FeedbackLine } from "./feedback-line"
export { StatusIndicator } from "./status-bar"
export { extractDiff } from "./format"

interface AppProps {
  provider: Provider
  createProvider?: (modelId: string) => Provider
  tools: ToolDefinition[]
  systemPrompt: string
  context: ToolContext
  initialSession?: Session
  initialView?: View
  sessionsDir?: string
  commands?: Command[]
  onSkillActivate?: (content: string) => void
}

type View = "home" | "chat"

export function App({ provider, createProvider, tools, systemPrompt, context, initialSession, initialView, sessionsDir, commands }: AppProps) {
  const [view, setView] = useState<View>(initialView ?? (initialSession ? "chat" : "home"))
  const { exit } = useApp()
  const { columns, rows } = useWindowSize()
  const { stdout } = useStdout()
  const [, mouseSetupTick] = useState(0)

  useEffect(() => {
    stdout.write(MOUSE_TRACKING_ENABLE)
    mouseSetupTick((n) => n + 1)
    return () => {
      stdout.write(MOUSE_TRACKING_DISABLE)
    }
  }, [stdout])

  const commandRegistry = useMemo(() => {
    const registry = new CommandRegistry()
    if (commands) registry.registerAll(commands)
    return registry
  }, [commands])

  const drafting = useChatDrafting()

  const session = useAgentSession({
    provider,
    createProvider,
    tools,
    systemPrompt,
    context,
    initialSession,
    sessionsDir,
    commands,
    openPicker: drafting.openPicker,
    resetDraft: drafting.resetInput,
    view,
    enterChat: () => setView("chat"),
    enterHome: () => setView("home"),
  })

  const allCommands = commandRegistry.getAll()
  const firstWord = drafting.inputValue.trim().split(/\s+/)[0] ?? ""
  const suggestedCommands = firstWord.startsWith("/") ? filterCommands(allCommands, firstWord) : []
  const suggestionVisible =
    !session.isStreaming &&
    !drafting.pickerRequest &&
    !session.pendingApproval &&
    !session.showExitSummary &&
    view === "chat" &&
    firstWord.startsWith("/") &&
    !drafting.suggestionDismissed
  const clampedSuggestionHighlight = Math.min(drafting.suggestionHighlight, Math.max(0, suggestedCommands.length - 1))

  useInput(
    (input, key) => {
      if (drafting.pickerRequest) return

      if (session.pendingApproval) {
        const lower = input.toLowerCase()
        if (lower === "y" || lower === "n") {
          session.resolveApproval(lower === "y")
        }
        return
      }

      if (session.showExitSummary) {
        exit()
        return
      }

      if (suggestionVisible) {
        if (key.upArrow) {
          drafting.setSuggestionHighlight((prev) => moveHighlight(prev, suggestedCommands.length, -1))
          return
        }
        if (key.downArrow) {
          drafting.setSuggestionHighlight((prev) => moveHighlight(prev, suggestedCommands.length, 1))
          return
        }
        if (key.escape) {
          drafting.setSuggestionDismissed(true)
          return
        }
      }

      if (key.return) {
        const suggestedCommand = suggestionVisible ? suggestedCommands[clampedSuggestionHighlight] : undefined
        if (suggestedCommand) {
          const typedRest = drafting.inputValue.trim().slice(firstWord.length)
          void session.handleSend(`/${suggestedCommand.name}${typedRest}`)
        } else if (drafting.inputValue.trim()) {
          void session.handleSend(drafting.inputValue)
        }
        return
      }

      if (key.escape && session.isStreaming) {
        session.abortCurrent()
      }
      if (key.ctrl && input === "c") {
        session.requestExitSummary()
      }
    },
    { isActive: true },
  )

  if (view === "home") {
    return (
      <Box flexDirection="column" width={columns} height={rows} backgroundColor={COLORS.appBackground}>
        <WelcomeScreen
          provider={session.providerState}
          onNewChat={session.startNewSession}
          onResumeSession={() => setView("chat")}
          hasResumableSession={!!initialSession}
          onSendFirstMessage={(text) => {
            drafting.setInputValue(text)
            setView("chat")
            setTimeout(() => {
              void session.handleSend(text)
            }, 50)
          }}
        />
        {drafting.pickerRequest && (
          <Picker
            title={drafting.pickerRequest.title}
            items={drafting.pickerRequest.items}
            onSelect={(index) => drafting.closePicker(index)}
            onCancel={() => drafting.closePicker(null)}
            rows={rows}
          />
        )}
      </Box>
    )
  }

  const sidebarWidth = Math.max(30, Math.floor(columns * 0.3))
  const chatWidth = columns - sidebarWidth - 1

  return (
    <Box flexDirection="column" width={columns} height={rows} backgroundColor={COLORS.appBackground}>
      <Box flexDirection="row" flexGrow={1}>
        <ChatPanel
          width={chatWidth}
          viewportHeight={Math.max(5, rows - CHAT_CHROME_LINES)}
          scrollDisabled={drafting.pickerRequest !== null || session.pendingApproval !== null || session.showExitSummary}
          runningTools={session.toolCalls.filter((tc) => !tc.result).map((tc) => ({ id: tc.id, name: tc.name }))}
          messages={session.messages}
          currentText={session.currentText}
          isStreaming={session.isStreaming}
          onSend={session.handleSend}
          feedbackEntries={session.feedbackEntries}
          inputKey={drafting.inputKey}
          inputValue={drafting.inputValue}
          inputDisabled={drafting.pickerRequest !== null}
          onInputChange={drafting.handleInputChange}
          suggestion={suggestionVisible ? { items: suggestedCommands, highlightIndex: clampedSuggestionHighlight } : undefined}
          modelName={session.providerState.getModelInfo().name}
        />
        <UsagePanel
          width={sidebarWidth}
          model={session.providerState.getModelInfo().name}
          contextLength={session.providerState.getModelInfo().contextLength}
          usage={session.usage}
          turns={session.turnCount}
          status={session.turnStatus}
        />
      </Box>
      <StatusBar usage={session.usage} model={session.providerState.getModelInfo().name} status={session.turnStatus} />
      {drafting.pickerRequest && (
        <Picker
          title={drafting.pickerRequest.title}
          items={drafting.pickerRequest.items}
          onSelect={(index) => drafting.closePicker(index)}
          onCancel={() => drafting.closePicker(null)}
          rows={rows}
        />
      )}
      {session.pendingApproval && (
        <ApprovalPrompt
          toolName={session.pendingApproval.toolName}
          args={session.pendingApproval.args}
        />
      )}
      {session.showExitSummary && (
        <ExitSummary usage={session.usage} model={session.providerState.getModelInfo().name} />
      )}
    </Box>
  )
}