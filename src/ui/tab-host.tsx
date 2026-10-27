import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { Box, useApp, useInput } from "ink"
import type { View } from "./view"
import type { Command, ToolContext, ToolDefinition } from "../core/types"
import type { Session } from "../core/session"
import type { Provider } from "../core/provider"
import type { TokenUsage } from "../core/provider"
import type { ProviderId } from "../core/providers"
import { CommandRegistry } from "../core/command-registry"
import { filterCommands, findUsageHint, moveHighlight } from "./command-suggestion"
import { detectMention, filterMentionFiles, listMentionableFiles } from "../core/file-mentions"
import { Picker } from "./picker"
import { routeLabel } from "./route-label"
import { WelcomeScreen } from "./welcome"
import { ChatPanel, CHAT_CHROME_LINES, SELECTION_FOOTER_LINES } from "./chat-panel"
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
import { copyToClipboard, type ClipboardResult } from "../core/clipboard"
import {
  clampSelectionIndex,
  selectableMessages,
  selectionPayload,
} from "./message-selection"

/** Puts text on the clipboard; injected so Select Mode can be tested without one. */
export type ClipboardWriter = (text: string) => Promise<ClipboardResult>

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
  /**
   * A Surface is waiting on an answer — a picker, a key prompt, a yes/no, an
   * approval, the exit summary — so the window must not route clicks away.
   */
  blocking: boolean
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
  /** Overrides the system clipboard in tests of Select Mode. */
  copyText?: ClipboardWriter
}

export interface TabHostProps extends TabHostDeps {
  /** Whether this conversation is the one the window is showing. */
  active: boolean
  view: View
  width: number
  height: number
  /** The host's first screen row, 1-based; the Tab Bar and any notice sit above it. */
  screenTop?: number
  onEnterChat: () => void
  onEnterHome: () => void
  /** Called when this conversation's badge-relevant state changes. */
  onSummaryChange?: (summary: TabSummary) => void
  onSessionChange?: (sessionId: string | null) => void
  onUsageChange?: (usage: TokenUsage) => void
  summaryUsage?: TokenUsage
  /** Called with the title the Tab Bar should show for this conversation. */
  onTitleChange?: (title: string) => void
  /** Tab keybindings. The window owns the set; the active host owns the keys. */
  onOpenTab?: () => void
  focusSession?: (sessionId: string) => boolean
  onPrevTab?: () => void
  onNextTab?: () => void
  onJumpTab?: (position: number) => void
  /** Closes this conversation's Tab. The window removes it from the set. */
  onCloseTab?: () => void
  /**
   * A click on the Bar's `×`. Each new count asks this Tab to close through the
   * same path as Ctrl+X, so a running Turn still gets its confirmation.
   */
  closeRequest?: number
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
  copyText,
  active,
  view,
  width,
  height,
  screenTop = 1,
  onEnterChat,
  onEnterHome,
  onSummaryChange,
  onSessionChange,
  onUsageChange,
  summaryUsage,
  onTitleChange,
  onOpenTab,
  focusSession,
  onPrevTab,
  onNextTab,
  onJumpTab,
  onCloseTab,
  closeRequest,
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
  // Select Mode is conversation state for the same reason scroll is: a hidden
  // host must remember nothing about it, and a switch must not leave the next
  // conversation with a highlight the user cannot see.
  const [selectionMode, setSelectionMode] = useState(false)
  const [selectionIndex, setSelectionIndex] = useState(0)
  const [markedMessageIds, setMarkedMessageIds] = useState<Set<string>>(() => new Set())
  // The message a drag started on. Kept outside render state because it only
  // matters while the pointer is down, and a move should not re-render for it.
  const selectionAnchorId = useRef<string | null>(null)

  /**
   * Puts a yes/no on screen and resolves to the answer. Its own state rather
   * than the session's, because the question belongs to whichever surface asked
   * it — the same way the key prompt is not the session's to own.
   */
  const confirmAction = useCallback(
    (message: string, confirmLabel: string) =>
      new Promise<boolean>((resolve) => {
        setConfirmation({ message, confirmLabel, resolve })
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

  /** The confirmation a Model switch that would shrink the context asks. */
  const confirmSwitch = useCallback(
    (warning: string) => confirmAction(warning, "Switch"),
    [confirmAction],
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
    openNewTab: onOpenTab,
    focusSession,
    keyFor,
    ensureKeyFor: (target) =>
      keyFor(target) ? Promise.resolve(true) : promptForKey(target, true),
    openKeyEntryFor: (target) => promptForKey(target, false),
    removeApiKeyFor: removeKey,
    confirmContextSwitch: confirmSwitch,
  })

  /**
   * Closes this Tab. A Turn still in flight is stopped first, but only after
   * the user agrees: closing a Tab is a window gesture, not a quiet way to lose
   * a minute of work. Closing never deletes a Session — completed Turns,
   * renames and switches have already written it, and a Tab that never got that
   * far has no Session to lose.
   */
  const requestCloseTab = useCallback(async () => {
    if (!onCloseTab) return
    if (session.isStreaming) {
      const confirmed = await confirmAction(
        "This Tab is still working. Close it and stop its Turn?",
        "Close",
      )
      if (!confirmed) return
      session.abortCurrent()
    }
    onCloseTab()
  }, [session, confirmAction, onCloseTab])

  // A click on the Bar's × is a request, not a command: it takes the same path
  // as Ctrl+X, including the question a running Turn raises. The count is
  // compared rather than a flag so declining one request does not swallow the
  // next. `requestCloseTab` changes identity with props, which is why the
  // comparison, not the effect, decides whether there is anything to answer.
  const answeredCloseRequest = useRef(0)
  useEffect(() => {
    if (!closeRequest || closeRequest === answeredCloseRequest.current) return
    answeredCloseRequest.current = closeRequest
    void requestCloseTab()
  }, [closeRequest, requestCloseTab])

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
  // A Surface that owns the keyboard also owns the Tab Bar's click targets.
  const blocking =
    drafting.pickerRequest !== null ||
    keyEntry !== null ||
    confirmation !== null ||
    session.pendingApproval !== null ||
    session.showExitSummary ||
    selectionMode
  useEffect(() => {
    onSummaryChangeRef.current?.({ streaming, needsApproval, errored, blocking })
  }, [streaming, needsApproval, errored, blocking])

  const onSessionChangeRef = useRef(onSessionChange)
  useEffect(() => {
    onSessionChangeRef.current = onSessionChange
  }, [onSessionChange])
  useEffect(() => {
    onSessionChangeRef.current?.(session.session?.id ?? null)
  }, [session.session?.id])

  const onUsageChangeRef = useRef(onUsageChange)
  useEffect(() => {
    onUsageChangeRef.current = onUsageChange
  }, [onUsageChange])
  useEffect(() => {
    onUsageChangeRef.current?.(session.usage)
  }, [session.usage])

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

  const copyableMessages = useMemo(() => selectableMessages(session.messages), [session.messages])
  const activeSelectionIndex = clampSelectionIndex(selectionIndex, copyableMessages.length)
  const activeSelection = copyableMessages[activeSelectionIndex]
  const markedSelectionCount = copyableMessages.reduce(
    (count, message) => count + (markedMessageIds.has(message.id) ? 1 : 0),
    0,
  )
  const clearSelection = useCallback(() => {
    selectionAnchorId.current = null
    setSelectionMode(false)
    setSelectionIndex(0)
    setMarkedMessageIds(new Set())
  }, [])

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
    if (switched || cleared) {
      setScrollOffset(0)
      clearSelection()
    }
  }, [conversationId, conversationEmpty, clearSelection])

  // A cleared transcript leaves nothing to select.
  useEffect(() => {
    if (selectionMode && copyableMessages.length === 0) clearSelection()
  }, [selectionMode, copyableMessages.length, clearSelection])

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
    !selectionMode &&
    !drafting.pickerRequest &&
    !keyEntry &&
    !confirmation &&
    !session.pendingApproval &&
    !session.showExitSummary

  const startSelection = useCallback(() => {
    if (!inputSurfaceReady || copyableMessages.length === 0) return
    setSelectionIndex(copyableMessages.length - 1)
    setMarkedMessageIds(new Set())
    setSelectionMode(true)
  }, [inputSurfaceReady, copyableMessages.length])

  const moveSelection = useCallback(
    (delta: -1 | 1) => {
      setSelectionIndex((index) => clampSelectionIndex(index + delta, copyableMessages.length))
    },
    [copyableMessages.length],
  )

  /**
   * A press starts a possible drag: the pressed message becomes the highlight,
   * any earlier marks are dropped, and it becomes the anchor of a range. A press
   * on a tool result or a Feedback Line names nothing and does nothing.
   */
  const pressMessage = useCallback(
    (messageId: string) => {
      if ((!inputSurfaceReady && !selectionMode) || copyableMessages.length === 0) return
      const index = copyableMessages.findIndex((message) => message.id === messageId)
      if (index < 0) return
      selectionAnchorId.current = messageId
      setSelectionIndex(index)
      setMarkedMessageIds(new Set())
      setSelectionMode(true)
    },
    [inputSurfaceReady, selectionMode, copyableMessages],
  )

  /**
   * Dragging marks every copyable message between the anchor and the pointer.
   * It trusts the anchor rather than this render's `selectionMode`, because a
   * terminal may deliver the press and its first motion in one chunk, before
   * the press's state update has rendered.
   */
  const dragSelectionTo = useCallback(
    (messageId: string) => {
      const anchorId = selectionAnchorId.current
      if (!anchorId) return
      const target = copyableMessages.findIndex((message) => message.id === messageId)
      if (target < 0) return
      const anchor = copyableMessages.findIndex((message) => message.id === anchorId)
      const edge = anchor < 0 ? target : anchor
      const from = Math.min(edge, target)
      const to = Math.max(edge, target)
      setSelectionMode(true)
      setSelectionIndex(target)
      setMarkedMessageIds(
        from === to
          ? new Set()
          : new Set(copyableMessages.slice(from, to + 1).map((message) => message.id)),
      )
    },
    [copyableMessages],
  )

  const releaseSelectionDrag = useCallback(() => {
    selectionAnchorId.current = null
  }, [])

  const nudgeSelection = useCallback(
    (delta: -1 | 1) => {
      if (!selectionMode) return
      moveSelection(delta)
    },
    [selectionMode, moveSelection],
  )

  const toggleMarkedMessage = useCallback(() => {
    if (!activeSelection) return
    setMarkedMessageIds((previous) => {
      const next = new Set(previous)
      if (next.has(activeSelection.id)) next.delete(activeSelection.id)
      else next.add(activeSelection.id)
      return next
    })
  }, [activeSelection])

  const copySelection = useCallback(async () => {
    if (!activeSelection) return
    const payload = selectionPayload(copyableMessages, markedMessageIds, activeSelection.id)
    if (payload.count === 0) return
    const write = copyText ?? copyToClipboard
    const result = await write(payload.text)
    if (result.kind === "failed") {
      session.notify(`Could not copy: ${result.reason}`, "error")
      return
    }
    session.notify(
      payload.count === 1
        ? "Copied message to clipboard."
        : `Copied ${payload.count} messages to clipboard.`,
    )
    clearSelection()
  }, [activeSelection, copyableMessages, markedMessageIds, copyText, session, clearSelection])

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

      // Select Mode owns every key until it closes, so a stray letter cannot
      // become a draft and a stray Enter cannot send one.
      if (selectionMode) {
        if (key.escape) {
          clearSelection()
          return
        }
        if (key.upArrow || key.downArrow) {
          moveSelection(key.upArrow ? -1 : 1)
          return
        }
        if (input === " ") {
          toggleMarkedMessage()
          return
        }
        if (key.return || (key.ctrl && input === "c")) {
          void copySelection()
          return
        }
        return
      }

      if (key.ctrl && input === "s" && inputSurfaceReady && copyableMessages.length > 0) {
        startSelection()
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
      if (key.ctrl && input === "x" && onCloseTab && view === "chat") {
        // A close gesture belongs to the Tab Bar, so it only works where that
        // Bar is on screen. `/home` parks Tabs behind the Welcome Screen, and a
        // Tab nobody can see must not disappear under the user.
        void requestCloseTab()
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
      {confirmation && (
        <ConfirmPrompt message={confirmation.message} confirmLabel={confirmation.confirmLabel} />
      )}
    </>
  )

  if (!active) return null

  if (view === "home") {
    return (
      <>
        <WelcomeScreen
          provider={session.providerState}
          onNewChat={onOpenTab ?? session.startNewSession}
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
          viewportHeight={Math.max(
            5,
            height - CHAT_CHROME_LINES - (selectionMode ? SELECTION_FOOTER_LINES : 0),
          )}
          mouseSelection={{
            screenTop,
            onPress: pressMessage,
            onDrag: dragSelectionTo,
            onRelease: releaseSelectionDrag,
            onNudge: nudgeSelection,
          }}
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
          inputDisabled={drafting.pickerRequest !== null || keyEntry !== null || confirmation !== null || selectionMode}
          onInputChange={drafting.handleInputChange}
          scrollOffset={scrollOffset}
          onScrollOffsetChange={setScrollOffset}
          selection={
            selectionMode && activeSelection
              ? {
                  activeId: activeSelection.id,
                  markedIds: markedMessageIds,
                  position: activeSelectionIndex + 1,
                  total: copyableMessages.length,
                  markedCount: markedSelectionCount,
                }
              : undefined
          }
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
        <ExitSummary usage={summaryUsage ?? session.usage} route={route} />
      )}
    </>
  )
}
