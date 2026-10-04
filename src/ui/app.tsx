import { useEffect, useMemo, useState, useRef, useCallback } from "react"
import { Box, useApp, useInput, useStdout, useWindowSize } from "ink"
import { MOUSE_TRACKING_ENABLE, MOUSE_TRACKING_DISABLE } from "./mouse"
import { COLORS } from "./theme"
import type { Command, ToolContext, ToolDefinition } from "../core/types"
import type { Session } from "../core/session"
import type { Provider } from "../core/provider"
import type { ProviderId } from "../core/providers"
import { CommandRegistry } from "../core/command-registry"
import { filterCommands, findUsageHint, moveHighlight } from "./command-suggestion"
import { Picker } from "./picker"
import { routeLabel } from "./route-label"
import { WelcomeScreen } from "./welcome"
import { ChatPanel, CHAT_CHROME_LINES } from "./chat-panel"
import { UsagePanel } from "./usage-panel"
import { StatusBar } from "./status-bar"
import { ApprovalPrompt } from "./approval-prompt"
import { ExitSummary } from "./exit-summary"
import { KeyEntryScreen } from "./key-entry-screen"
import { CenteredOverlay } from "./centered-overlay"
import { useChatDrafting } from "./use-chat-drafting"
import { useAgentSession } from "./use-agent-session"

export { STREAMING_COMMAND_NOTICE } from "./use-agent-session"
export type { FeedbackTone, FeedbackEntry } from "./feedback-line"
export { FeedbackLine } from "./feedback-line"
export { StatusIndicator } from "./status-bar"
export { extractDiff } from "./format"

interface AppProps {
  provider: Provider
  createProvider?: (canonicalModelId: string, apiKey: string) => Provider
  tools: ToolDefinition[]
  projectPrompt?: string
  cliPrompt?: string
  context: ToolContext
  initialSession?: Session
  initialView?: View
  sessionsDir?: string
  commands?: Command[]
  /** Resolves a Provider's key from config plus environment. */
  keyFor: (provider: ProviderId) => string | undefined
  onSaveApiKey?: (provider: ProviderId, apiKey: string) => void
  onRemoveApiKey?: (provider: ProviderId) => void
  onSkillActivate?: (content: string) => void
}

type View = "home" | "chat"

interface KeyEntryRequest {
  resolve: (ok: boolean) => void
  requireKey: boolean
  provider: ProviderId
}

export function App({ provider, createProvider, tools, projectPrompt, cliPrompt, context, initialSession, initialView, sessionsDir, commands, keyFor, onSaveApiKey, onRemoveApiKey }: AppProps) {
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

  const [keyEntry, setKeyEntry] = useState<KeyEntryRequest | null>(null)

  /**
   * Opens the API Key Entry Screen for a Provider and resolves to whether a key
   * was supplied. `requireKey` decides whether Escape can dismiss it.
   */
  const promptForKey = useCallback(
    (target: ProviderId, requireKey: boolean) =>
      new Promise<boolean>((resolve) => {
        setKeyEntry({ resolve, requireKey, provider: target })
      }),
    [],
  )

  const removeKey = useCallback(
    async (target: ProviderId) => {
      const hadKey = keyFor(target) !== undefined
      onRemoveApiKey?.(target)
      return hadKey
    },
    [keyFor, onRemoveApiKey],
  )

  const session = useAgentSession({
    provider,
    createProvider,
    tools,
    projectPrompt,
    cliPrompt,
    context,
    initialSession,
    sessionsDir,
    commands,
    openPicker: drafting.openPicker,
    resetDraft: drafting.resetInput,
    resetHistory: drafting.resetHistory,
    view,
    enterChat: () => setView("chat"),
    enterHome: () => setView("home"),
    keyFor,
    ensureKeyFor: (target) =>
      keyFor(target) ? Promise.resolve(true) : promptForKey(target, true),
    openKeyEntryFor: (target) => promptForKey(target, false),
    removeApiKeyFor: removeKey,
  })

  const submitKey = useCallback(
    (apiKey: string) => {
      if (!keyEntry) return
      onSaveApiKey?.(keyEntry.provider, apiKey)
      session.applyApiKey(keyEntry.provider, apiKey)
      keyEntry.resolve(true)
      setKeyEntry(null)
    },
    [keyEntry, onSaveApiKey, session],
  )

  const cancelKey = useCallback(() => {
    if (!keyEntry) return
    keyEntry.resolve(false)
    setKeyEntry(null)
  }, [keyEntry])

  const renderKeyEntry = (entry: KeyEntryRequest) => (
    <CenteredOverlay width={columns} height={rows}>
      <KeyEntryScreen
        provider={entry.provider}
        requireKey={entry.requireKey}
        initialValue={keyFor(entry.provider) ?? ""}
        onSubmit={submitKey}
        onCancel={cancelKey}
      />
    </CenteredOverlay>
  )

  const allCommands = commandRegistry.getAll()
  const firstWord = drafting.inputValue.trim().split(/\s+/)[0] ?? ""
  const suggestedCommands = firstWord.startsWith("/") ? filterCommands(allCommands, firstWord) : []
  const suggestionVisible =
    !session.isStreaming &&
    !drafting.pickerRequest &&
    !keyEntry &&
    !session.pendingApproval &&
    !session.showExitSummary &&
    view === "chat" &&
    firstWord.startsWith("/") &&
    !drafting.suggestionDismissed
  const clampedSuggestionHighlight = Math.min(drafting.suggestionHighlight, Math.max(0, suggestedCommands.length - 1))
  const suggestionArrows = suggestionVisible && suggestedCommands.length > 0
  const suggestionHint = suggestionVisible ? findUsageHint(allCommands, drafting.inputValue) : undefined

  useInput(
    (input, key) => {
      if (drafting.pickerRequest) return

      if (keyEntry) return

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

      if (suggestionArrows) {
        if (key.upArrow) {
          drafting.setSuggestionHighlight((prev) => moveHighlight(prev, suggestedCommands.length, -1))
          return
        }
        if (key.downArrow) {
          drafting.setSuggestionHighlight((prev) => moveHighlight(prev, suggestedCommands.length, 1))
          return
        }
      }

      if (key.escape && suggestionVisible) {
        drafting.setSuggestionDismissed(true)
        return
      }

      if (key.upArrow && !suggestionArrows && view === "chat" && !session.isStreaming) {
        drafting.recallUp()
        return
      }
      if (key.downArrow && !suggestionArrows && view === "chat" && !session.isStreaming) {
        drafting.recallDown()
        return
      }

      if (key.return) {
        const suggestedCommand = suggestionVisible ? suggestedCommands[clampedSuggestionHighlight] : undefined
        if (suggestedCommand) {
          const typedRest = drafting.inputValue.trim().slice(firstWord.length)
          const commandInput = `/${suggestedCommand.name}${typedRest}`
          drafting.submitInput(commandInput)
          void session.handleSend(commandInput)
        } else if (drafting.inputValue.trim()) {
          const message = drafting.inputValue
          drafting.submitInput(message)
          void session.handleSend(message)
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
          onTab={session.cycleMode}
          mode={session.activeModeDefinition}
          projectRoot={context.projectPath}
          onSendFirstMessage={(text) => {
            drafting.setInputValue(text)
            setView("chat")
            setTimeout(() => {
              drafting.submitInput(text)
              void session.handleSend(text)
            }, 50)
          }}
        />
        {drafting.pickerRequest && (
          <Picker
            {...drafting.pickerRequest}
            onSelect={(index) => drafting.closePicker(index)}
            onCancel={() => drafting.closePicker(null)}
            rows={rows}
          />
        )}
        {keyEntry && renderKeyEntry(keyEntry)}
      </Box>
    )
  }

  const usagePanelWidth = Math.max(30, Math.floor(columns * 0.3))
  const chatWidth = columns - usagePanelWidth - 1
  // One read of the live Model, named once: every surface below names the same
  // route, so they cannot drift apart on a switch.
  const liveModel = session.providerState.getModelInfo()
  const route = routeLabel(liveModel)

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
          inputDisabled={drafting.pickerRequest !== null || keyEntry !== null}
          onInputChange={drafting.handleInputChange}
          suggestion={suggestionVisible ? { items: suggestedCommands, highlightIndex: clampedSuggestionHighlight, hint: suggestionHint } : undefined}
          route={route}
          mode={session.activeModeDefinition}
          onTab={session.cycleMode}
        />
        <UsagePanel
          width={usagePanelWidth}
          route={route}
          contextLength={liveModel.contextLength}
          usage={session.usage}
          turns={session.turnCount}
          status={session.turnStatus}
          projectRoot={context.projectPath}
        />
      </Box>
      <StatusBar usage={session.usage} route={route} status={session.turnStatus} />
      {drafting.pickerRequest && (
        <Picker
          {...drafting.pickerRequest}
          onSelect={(index) => drafting.closePicker(index)}
          onCancel={() => drafting.closePicker(null)}
          rows={rows}
        />
      )}
      {keyEntry && renderKeyEntry(keyEntry)}
      {session.pendingApproval && (
        <ApprovalPrompt
          toolName={session.pendingApproval.toolName}
          args={session.pendingApproval.args}
        />
      )}
      {session.showExitSummary && (
        <ExitSummary usage={session.usage} route={route} />
      )}
    </Box>
  )
}