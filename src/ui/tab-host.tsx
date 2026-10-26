import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { Box, useApp, useInput } from "ink"
import type { View } from "./view"
import type { Command, ToolContext, ToolDefinition } from "../core/types"
import type { Session } from "../core/session"
import type { Provider } from "../core/provider"
import type { ProviderId } from "../core/providers"
import { CommandRegistry } from "../core/command-registry"
import { filterCommands, findUsageHint, moveHighlight } from "./command-suggestion"
import { detectMention, filterMentionFiles, listMentionableFiles } from "../core/file-mentions"
import { Picker } from "./picker"
import { routeLabel } from "./route-label"
import { WelcomeScreen } from "./welcome"
import { ChatPanel, CHAT_CHROME_LINES } from "./chat-panel"
import { UsagePanel } from "./usage-panel"
import { StatusBar } from "./status-bar"
import { ApprovalPrompt, approvalOptions } from "./approval-prompt"
import { ConfirmPrompt, type PendingConfirmation } from "./confirm-prompt"
import { ExitSummary } from "./exit-summary"
import { KeyEntryScreen } from "./key-entry-screen"
import { CenteredOverlay } from "./centered-overlay"
import { useChatDrafting } from "./use-chat-drafting"
import { useAgentSession } from "./use-agent-session"
import { firstUserMessage, tabTitle } from "./tab-set"

interface KeyEntryRequest {
  resolve: (ok: boolean) => void
  requireKey: boolean
  provider: ProviderId
}

/**
 * What the window needs to know about a conversation without owning any of it:
 * enough to draw a Tab's badge and to know whether it is safe to leave.
 */
export interface TabSummary {
  streaming: boolean
  needsApproval: boolean
  errored: boolean
}

/** The conversation-scoped dependencies every host needs, shared with the App. */
export interface TabHostDeps {
  provider: Provider
  createProvider?: (canonicalModelId: string, apiKey: string) => Provider
  tools: ToolDefinition[]
  projectPrompt?: string
  cliPrompt?: string
  context: ToolContext
  initialSession?: Session
  sessionsDir?: string
  commands?: Command[]
  keyFor: (provider: ProviderId) => string | undefined
  onSaveApiKey?: (provider: ProviderId, apiKey: string) => void
  onRemoveApiKey?: (provider: ProviderId) => void
}

export interface TabHostProps extends TabHostDeps {
  /** Whether this conversation is the one the window is showing. */
  active: boolean
  view: View
  width: number
  height: number
  onEnterChat: () => void
  onEnterHome: () => void
  /** Called when this conversation's badge-relevant state changes. */
  onSummaryChange?: (summary: TabSummary) => void
  /** Called with the title the Tab Bar should show for this conversation. */
  onTitleChange?: (title: string) => void
  /** Tab keybindings. The window owns the set; the active host owns the keys. */
  onOpenTab?: () => void
  onPrevTab?: () => void
  onNextTab?: () => void
  onJumpTab?: (position: number) => void
}

/**
 * Owns one conversation: its transcript, draft, Mode, Turn, approvals and the
 * surfaces that show them. Rendered once per Tab. An inactive host returns
 * null while staying mounted, so a hidden conversation keeps its state and its
 * Turn rather than being torn down by the switch.
 */
export function TabHost({
  provider,
  createProvider,
  tools,
  projectPrompt,
  cliPrompt,
  context,
  initialSession,
  sessionsDir,
  commands,
  keyFor,
  onSaveApiKey,
  onRemoveApiKey,
  active,
  view,
  width,
  height,
  onEnterChat,
  onEnterHome,
  onSummaryChange,
  onTitleChange,
  onOpenTab,
  onPrevTab,
  onNextTab,
  onJumpTab,
}: TabHostProps) {
  const { exit } = useApp()
  const commandRegistry = useMemo(() => {
    const registry = new CommandRegistry()
    if (commands) registry.registerAll(commands)
    return registry
  }, [commands])

  const drafting = useChatDrafting()

  const [keyEntry, setKeyEntry] = useState<KeyEntryRequest | null>(null)
  const [confirmation, setConfirmation] = useState<PendingConfirmation | null>(null)

  /**
   * Puts a yes/no on screen and resolves to the answer. Its own state rather
   * than the session's, because the question belongs to whichever surface asked
   * it — the same way the key prompt is not the session's to own.
   */
  const confirmAction = useCallback(
    (message: string) =>
      new Promise<boolean>((resolve) => {
        setConfirmation({ message, resolve })
      }),
    [],
  )

  const answerConfirmation = useCallback(
    (confirmed: boolean) => {
      if (!confirmation) return
      confirmation.resolve(confirmed)
      setConfirmation(null)
    },
    [confirmation],
  )

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
    enterChat: onEnterChat,
    enterHome: onEnterHome,
    keyFor,
    ensureKeyFor: (target) =>
      keyFor(target) ? Promise.resolve(true) : promptForKey(target, true),
    openKeyEntryFor: (target) => promptForKey(target, false),
    removeApiKeyFor: removeKey,
    confirmContextSwitch: confirmAction,
  })

  // The report goes up through a ref so a caller that passes a fresh callback
  // each render cannot make the effect fire again and again; only a change in
  // the conversation's state is news to the window.
  const onSummaryChangeRef = useRef(onSummaryChange)
  useEffect(() => {
    onSummaryChangeRef.current = onSummaryChange
  }, [onSummaryChange])

  const streaming = session.isStreaming
  const needsApproval = session.pendingApproval !== null
  const errored = session.turnStatus.kind === "error"
  useEffect(() => {
    onSummaryChangeRef.current?.({ streaming, needsApproval, errored })
  }, [streaming, needsApproval, errored])

  // Same ref pattern for the title: renaming a Session or sending a first
  // message must retitle the Tab Bar, and only those changes should. The title
  // is memoized because a streaming Tab re-renders on every delta, and
  // tokenizing the first message per token would be wasted work.
  const onTitleChangeRef = useRef(onTitleChange)
  useEffect(() => {
    onTitleChangeRef.current = onTitleChange
  }, [onTitleChange])

  const title = useMemo(
    () =>
      tabTitle({
        name: session.session?.name,
        firstUserMessage: firstUserMessage(session.messages),
      }),
    [session.session?.name, session.messages],
  )
  useEffect(() => {
    onTitleChangeRef.current?.(title)
  }, [title])

  // Scroll is conversation state, so it lives here rather than in ChatPanel:
  // a hidden host renders null, which would otherwise take the offset with it.
  // It is kept unclamped — ChatPanel clamps it to the transcript it has, so a
  // reply that shrinks below the offset and then grows again keeps the place.
  const [scrollOffset, setScrollOffset] = useState(0)

  // A different conversation starts at the bottom. Carrying the old offset
  // over would open a short, fresh transcript somewhere in its middle. A first
  // save is not a switch: a Tab that is scrolled up while its very first reply
  // finishes must keep its place.
  const conversationId = session.session?.id
  const conversationEmpty = session.messages.length === 0
  const previousConversation = useRef({ id: conversationId, empty: conversationEmpty })
  useEffect(() => {
    const previous = previousConversation.current
    previousConversation.current = { id: conversationId, empty: conversationEmpty }
    const switched =
      previous.id !== undefined &&
      conversationId !== undefined &&
      previous.id !== conversationId
    const cleared = !previous.empty && conversationEmpty
    if (switched || cleared) setScrollOffset(0)
  }, [conversationId, conversationEmpty])

  // The highlighted Approval Prompt choice. It resets for every new question,
  // so Enter always answers the question on screen rather than a stale index.
  const [approvalSelection, setApprovalSelection] = useState(0)
  useEffect(() => {
    setApprovalSelection(0)
  }, [session.pendingApproval])

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
    <CenteredOverlay width={width} height={height}>
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

  // Nothing may claim a keystroke while a surface is waiting on one: the draft
  // suggestions are offered only when the conversation is the thing being typed
  // into. Every suggestion below reads this same predicate so they cannot drift.
  const inputSurfaceReady =
    view === "chat" &&
    !session.isStreaming &&
    !drafting.pickerRequest &&
    !keyEntry &&
    !confirmation &&
    !session.pendingApproval &&
    !session.showExitSummary

  const suggestedCommands = firstWord.startsWith("/") ? filterCommands(allCommands, firstWord) : []
  const suggestionVisible =
    inputSurfaceReady &&
    firstWord.startsWith("/") &&
    !drafting.suggestionDismissed
  const clampedSuggestionHighlight = Math.min(drafting.suggestionHighlight, Math.max(0, suggestedCommands.length - 1))
  const suggestionArrows = suggestionVisible && suggestedCommands.length > 0
  const suggestionHint = suggestionVisible ? findUsageHint(allCommands, drafting.inputValue) : undefined

  // A File Mention lives inside a message, so it is offered only when the draft
  // is not a Command attempt: a slash command carries arguments, not mentions.
  const mention = firstWord.startsWith("/") ? null : detectMention(drafting.inputValue, drafting.inputCursor)
  const fileSuggestionVisible =
    inputSurfaceReady &&
    mention !== null &&
    !drafting.fileMentionDismissed
  const mentionFiles =
    fileSuggestionVisible && mention
      ? filterMentionFiles(listMentionableFiles(context.projectPath), mention.fragment)
      : []
  const clampedFileHighlight = Math.min(drafting.fileMentionHighlight, Math.max(0, mentionFiles.length - 1))
  const fileSuggestionArrows = fileSuggestionVisible && mentionFiles.length > 0

  useInput(
    (input, key) => {
      if (drafting.pickerRequest) return

      if (keyEntry) return

      // A yes/no has to be answered before anything else is read: every key
      // that follows would otherwise be taken as a draft or a command.
      if (confirmation) {
        const lower = input.toLowerCase()
        if (lower === "y") {
          answerConfirmation(true)
        } else if (lower === "n" || key.escape) {
          answerConfirmation(false)
        }
        return
      }

      if (session.pendingApproval) {
        const options = approvalOptions(session.pendingApproval.toolName)
        if (key.upArrow || key.downArrow) {
          const step = key.upArrow ? -1 : 1
          setApprovalSelection((prev) => (prev + step + options.length) % options.length)
          return
        }
        if (key.return) {
          const choice = options[Math.min(approvalSelection, options.length - 1)] ?? options[0]!
          session.resolveApproval(choice.decision)
        }
        return
      }

      if (session.showExitSummary) {
        exit()
        return
      }

      // Tab keys come after every surface that owns the keyboard, so a prompt
      // or a picker can never have its keys stolen by a switch. Only the
      // active host is listening, so a hidden Tab cannot answer them either.
      if (key.ctrl && key.leftArrow) {
        onPrevTab?.()
        return
      }
      if (key.ctrl && key.rightArrow) {
        onNextTab?.()
        return
      }
      if (key.ctrl && input === "t") {
        onOpenTab?.()
        return
      }
      if (key.ctrl && /^[1-9]$/.test(input)) {
        onJumpTab?.(Number(input))
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

      if (fileSuggestionArrows) {
        if (key.upArrow) {
          drafting.setFileMentionHighlight((prev) => moveHighlight(prev, mentionFiles.length, -1))
          return
        }
        if (key.downArrow) {
          drafting.setFileMentionHighlight((prev) => moveHighlight(prev, mentionFiles.length, 1))
          return
        }
      }

      if (key.escape && fileSuggestionVisible) {
        drafting.setFileMentionDismissed(true)
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
        } else if (fileSuggestionVisible && mention && mentionFiles.length > 0) {
          // A mention is one word of a message, so accepting it completes the
          // draft and leaves the floor open rather than sending anything.
          drafting.replaceDraftRange(mention.start, drafting.inputCursor, `@${mentionFiles[clampedFileHighlight]!} `)
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
    { isActive: active },
  )

  // These surfaces can be raised from either view and each owns a promise its
  // caller is awaiting. They therefore have to stay rendered wherever the
  // conversation happens to be — an unrendered prompt would leave the switch or
  // command that raised it hanging. A command always moves to the chat view
  // first, so a confirmation on the home screen is not expected, only possible.
  const overlays = (
    <>
      {drafting.pickerRequest && (
        <Picker
          {...drafting.pickerRequest}
          onSelect={(index) => drafting.closePicker(index)}
          onCancel={() => drafting.closePicker(null)}
          rows={height}
        />
      )}
      {keyEntry && renderKeyEntry(keyEntry)}
      {confirmation && <ConfirmPrompt message={confirmation.message} confirmLabel="Switch" />}
    </>
  )

  if (!active) return null

  if (view === "home") {
    return (
      <>
        <WelcomeScreen
          provider={session.providerState}
          onNewChat={session.startNewSession}
          onResumeSession={onEnterChat}
          hasResumableSession={!!initialSession}
          onTab={session.cycleMode}
          mode={session.activeModeDefinition}
          projectRoot={context.projectPath}
          onSendFirstMessage={(text) => {
            drafting.setInputValue(text)
            onEnterChat()
            setTimeout(() => {
              drafting.submitInput(text)
              void session.handleSend(text)
            }, 50)
          }}
        />
        {overlays}
      </>
    )
  }

  const usagePanelWidth = Math.max(30, Math.floor(width * 0.3))
  const chatWidth = width - usagePanelWidth - 1
  // One read of the live Model, named once: every surface below names the same
  // route, so they cannot drift apart on a switch.
  const liveModel = session.providerState.getModelInfo()
  const route = routeLabel(liveModel)

  return (
    <>
      <Box flexDirection="row" flexGrow={1}>
        <ChatPanel
          width={chatWidth}
          viewportHeight={Math.max(5, height - CHAT_CHROME_LINES)}
          scrollDisabled={
            drafting.pickerRequest !== null ||
            confirmation !== null ||
            session.pendingApproval !== null ||
            session.showExitSummary
          }
          runningTools={session.toolCalls.filter((tc) => !tc.result).map((tc) => ({ id: tc.id, name: tc.name }))}
          messages={session.messages}
          currentText={session.currentText}
          isStreaming={session.isStreaming}
          onSend={session.handleSend}
          feedbackEntries={session.feedbackEntries}
          inputKey={drafting.inputKey}
          inputValue={drafting.inputValue}
          initialCursor={drafting.inputCursor}
          inputDisabled={drafting.pickerRequest !== null || keyEntry !== null || confirmation !== null}
          onInputChange={drafting.handleInputChange}
          scrollOffset={scrollOffset}
          onScrollOffsetChange={setScrollOffset}
          suggestion={suggestionVisible ? { items: suggestedCommands, highlightIndex: clampedSuggestionHighlight, hint: suggestionHint } : undefined}
          fileSuggestion={fileSuggestionVisible ? { items: mentionFiles, highlightIndex: clampedFileHighlight } : undefined}
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
      {overlays}
      {session.pendingApproval && (
        <ApprovalPrompt
          toolName={session.pendingApproval.toolName}
          args={session.pendingApproval.args}
          selected={approvalSelection}
        />
      )}
      {session.showExitSummary && (
        <ExitSummary usage={session.usage} route={route} />
      )}
    </>
  )
}
