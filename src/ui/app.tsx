import { useCallback, useEffect, useRef, useState } from "react"
import { Box, useInput, useStdout, useWindowSize } from "ink"
import { MOUSE_TRACKING_ENABLE, MOUSE_TRACKING_DISABLE, parseMouseClick } from "./mouse"
import { COLORS } from "./theme"
import { TabHost, type TabHostDeps } from "./tab-host"
import { TAB_BAR_HEIGHT, TabBar, type TabBarItem } from "./tab-bar"
import { hitTestTabBar } from "./tab-bar-layout"
import { FeedbackLine } from "./feedback-line"
import {
  NEW_CHAT_TITLE,
  closeTab,
  createTabSet,
  firstUserMessage,
  focusTab,
  jumpToTab,
  nextTab,
  openTab,
  previousTab,
  setTabTitle,
  tabTitle,
  type TabSet,
} from "./tab-set"
import type { TabSummary } from "./tab-host"
import type { View } from "./view"
import type { TokenUsage } from "../core/provider"

export { STREAMING_COMMAND_NOTICE } from "./use-agent-session"
export type { FeedbackTone, FeedbackEntry } from "./feedback-line"
export { FeedbackLine } from "./feedback-line"
export { StatusIndicator } from "./status-bar"
export { extractDiff } from "./format"

interface AppProps extends TabHostDeps {
  initialView?: View
}

/**
 * The Bar is the first row of the frame. The window is as tall as the terminal,
 * so its frame starts at the terminal's top row and the absolute row a click
 * reports is the row on the Bar.
 */
const TAB_BAR_ROW = 1

/**
 * The window. It owns the view (home or chat), the Tab set and the
 * mouse-tracking lifecycle; each conversation lives in its own
 * {@link TabHost}, which owns the draft, transcript, Mode, Turn and overlays
 * for that conversation. A host that is not active renders nothing but stays
 * mounted, so opening, switching and coming back keeps every conversation's
 * state. The Tab set itself is plain data in `tab-set.ts`; this component only
 * holds it and routes the keys the active host reports.
 */
export function App({ initialView, initialSession, ...hostProps }: AppProps) {
  const initialTitle = initialSession
    ? tabTitle({
        name: initialSession.name,
        firstUserMessage: firstUserMessage(initialSession.messages),
      })
    : undefined
  const [view, setView] = useState<View>(
    initialView ?? (initialSession ? "chat" : "home"),
  )
  const [tabs, setTabs] = useState<TabSet>(() =>
    view === "chat" ? openTab(createTabSet(), { title: initialTitle }) : createTabSet(),
  )
  const [summaries, setSummaries] = useState<Record<string, TabSummary>>({})
  const sessionTabsRef = useRef(new Map<string, string>())
  const [tabUsage, setTabUsage] = useState<Record<string, TokenUsage>>({})
  // A click on the Bar's × cannot close a Tab directly: a running Turn asks
  // first, and that question belongs to the Tab's own host. The window counts
  // requests per Tab; each host answers the ones it has not seen yet.
  const [closeRequests, setCloseRequests] = useState<Record<string, number>>({})
  // The pre-Tab host the window starts with while the Welcome Screen is up is
  // not a Tab yet: the first message, or a new-Tab key, turns it into the first
  // one, so the Tab Bar never names a Tab that does not exist. Its id carries a
  // generation because a closed conversation's host must not be reused for the
  // next Welcome Screen.
  const [preTabGeneration, setPreTabGeneration] = useState(0)
  const preTabHostId = `tab-pre-${preTabGeneration}`
  // The resumed Session belongs to the host the window started with, wherever
  // it is: a Tab already, or still the pre-Tab draft on the Welcome Screen.
  // Cleared when the last Tab closes, so a later Welcome Screen starts blank.
  const initialHostId = useRef<string | null>(tabs.activeId ?? preTabHostId)
  // The pre-Tab host is not in the set yet, so its title is kept here until it
  // becomes a Tab; otherwise a resumed Session's name would be lost on entry.
  const preTabTitle = useRef<string>(initialTitle ?? NEW_CHAT_TITLE)
  // The close path can resume after more than one render (a running Turn asks
  // first), so it reads the set as it stands then rather than the one captured
  // when Ctrl+X was pressed.
  const tabsRef = useRef(tabs)
  tabsRef.current = tabs
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

  /** Opens a Tab under an id the pre-Tab host is already rendered with. */
  const adoptPreTab = useCallback(
    (state: TabSet) => openTab(state, { id: preTabHostId, title: preTabTitle.current }),
    [preTabHostId],
  )
  const openFirstTab = useCallback(() => {
    setTabs((previous) => (previous.tabs.length === 0 ? adoptPreTab(previous) : previous))
  }, [adoptPreTab])

  const enterChat = useCallback(() => {
    openFirstTab()
    setView("chat")
  }, [openFirstTab])
  const enterHome = useCallback(() => setView("home"), [])
  const openNewTab = useCallback(() => {
    setTabs((previous) =>
      previous.tabs.length === 0 ? adoptPreTab(previous) : openTab(previous),
    )
    setView("chat")
  }, [adoptPreTab])
  const goToPreviousTab = useCallback(() => setTabs((previous) => previousTab(previous)), [])
  const goToNextTab = useCallback(() => setTabs((previous) => nextTab(previous)), [])
  const jumpTab = useCallback(
    (position: number) => setTabs((previous) => jumpToTab(previous, position)),
    [],
  )
  const setTitle = useCallback((id: string, title: string) => {
    if (id === preTabHostId) preTabTitle.current = title
    setTabs((previous) => setTabTitle(previous, id, title))
  }, [preTabHostId])
  const setSummary = useCallback((id: string, summary: TabSummary) => {
    setSummaries((previous) => {
      const current = previous[id]
      if (
        current?.streaming === summary.streaming &&
        current.needsApproval === summary.needsApproval &&
        current.errored === summary.errored &&
        current.blocking === summary.blocking
      ) {
        return previous
      }
      return { ...previous, [id]: summary }
    })
  }, [])
  const setSessionId = useCallback((tabId: string, sessionId: string | null) => {
    for (const [knownSessionId, knownTabId] of sessionTabsRef.current) {
      if (knownTabId === tabId) sessionTabsRef.current.delete(knownSessionId)
    }
    if (sessionId) sessionTabsRef.current.set(sessionId, tabId)
  }, [])
  const setUsage = useCallback((id: string, usage: TokenUsage) => {
    setTabUsage((previous) => ({ ...previous, [id]: usage }))
  }, [])
  const focusSession = useCallback((sessionId: string) => {
    const tabId = sessionTabsRef.current.get(sessionId)
    if (!tabId) return false
    setTabs((previous) => focusTab(previous, tabId))
    setView("chat")
    return true
  }, [])

  /**
   * Asks the Tab's own host to close it, so a running Turn is stopped only
   * after the question that host owns. Used by a click on the Bar's `×`.
   */
  const requestCloseTab = useCallback((id: string) => {
    setCloseRequests((previous) => ({ ...previous, [id]: (previous[id] ?? 0) + 1 }))
  }, [])

  /**
   * Closes a Tab and, when it was the last one, returns to the Welcome Screen.
   * The fresh pre-Tab host and the cleared Session seed are what make that
   * screen a new beginning rather than the closed conversation under another
   * name.
   */
  const closeTabById = useCallback((id: string) => {
    const closed = closeTab(tabsRef.current, id)
    if (closed === tabsRef.current) return
    tabsRef.current = closed
    setTabs(closed)
    setSummaries((previous) => {
      if (!(id in previous)) return previous
      const next = { ...previous }
      delete next[id]
      return next
    })
    setTabUsage((previous) => {
      if (!(id in previous)) return previous
      const next = { ...previous }
      delete next[id]
      return next
    })
    setCloseRequests((previous) => {
      if (!(id in previous)) return previous
      const next = { ...previous }
      delete next[id]
      return next
    })
    setSessionId(id, null)
    if (closed.tabs.length > 0) return
    initialHostId.current = null
    preTabTitle.current = NEW_CHAT_TITLE
    setPreTabGeneration((generation) => generation + 1)
    setView("home")
  }, [])

  // Before the first message there is no Tab, only the host that is about to
  // become one.
  const hosts = tabs.tabs.length > 0 ? tabs.tabs : [{ id: preTabHostId }]
  const activeId = tabs.activeId ?? preTabHostId
  // The Tab Bar is absent on the Welcome Screen, and takes exactly its row
  // from the panels when it is there.
  const showingBar = view === "chat" && tabs.tabs.length > 0
  const panelHeight = rows - (showingBar ? TAB_BAR_HEIGHT : 0)
  const backgroundApproval = tabs.tabs.find(
    (tab) => tab.id !== activeId && summaries[tab.id]?.needsApproval,
  )
  const feedbackHeight = backgroundApproval ? 1 : 0
  // Pointer reports carry screen cells, so the panels need to know the one row
  // the Tab Bar takes and any notice above them. Row 1 is the window's first.
  const panelTop = (showingBar ? TAB_BAR_HEIGHT : 0) + feedbackHeight + 1
  const summaryUsage = Object.values(tabUsage).reduce<TokenUsage>(
    (total, usage) => ({
      inputTokens: total.inputTokens + usage.inputTokens,
      outputTokens: total.outputTokens + usage.outputTokens,
      totalTokens: total.totalTokens + usage.totalTokens,
      cost:
        total.cost === null || usage.cost === null
          ? null
          : total.cost + usage.cost,
    }),
    { inputTokens: 0, outputTokens: 0, totalTokens: 0, cost: 0 },
  )

  // The Bar and its mouse targets are laid out from the same data, so a click
  // can name the Tab the user actually saw. `+` is the last cell after the
  // visible slots.
  const barTabs: TabBarItem[] = tabs.tabs.map((tab) => ({
    id: tab.id,
    title: tab.title,
    active: tab.id === activeId,
    status: summaries[tab.id]?.needsApproval
      ? "approval"
      : summaries[tab.id]?.errored
        ? "error"
        : summaries[tab.id]?.streaming
          ? "streaming"
          : undefined,
  }))
  // A host that is waiting on an answer owns the keyboard; it owns the Bar too,
  // so a click cannot hide the question it is waiting on.
  const barBlocked = summaries[activeId]?.blocking === true

  useInput((input) => {
    if (!showingBar || barBlocked) return
    const click = parseMouseClick(input)
    if (!click || click.row !== TAB_BAR_ROW) return
    const hit = hitTestTabBar(barTabs, columns, click.column - 1)
    if (!hit) return
    if (hit.kind === "plus") {
      openNewTab()
      return
    }
    const target = tabs.tabs[hit.index]
    if (!target) return
    if (hit.close) {
      // The host answers this one, so a running Turn still gets its question.
      requestCloseTab(target.id)
      return
    }
    setTabs((previous) => focusTab(previous, target.id))
  })

  return (
    <Box flexDirection="column" width={columns} height={rows} backgroundColor={COLORS.appBackground}>
      {showingBar && <TabBar width={columns} tabs={barTabs} />}
      {backgroundApproval && (
        <FeedbackLine
          text={`Tab "${backgroundApproval.title}" is waiting for approval`}
          tone="warning"
        />
      )}
      {hosts.map((tab) => (
        <TabHost
          key={tab.id}
          {...hostProps}
          initialSession={tab.id === initialHostId.current ? initialSession : undefined}
          active={tab.id === activeId}
          view={view}
          width={columns}
          height={panelHeight - feedbackHeight}
          screenTop={panelTop}
          onEnterChat={enterChat}
          onEnterHome={enterHome}
          onTitleChange={(title) => setTitle(tab.id, title)}
          onSummaryChange={(summary) => setSummary(tab.id, summary)}
          onSessionChange={(sessionId) => setSessionId(tab.id, sessionId)}
          onUsageChange={(usage) => setUsage(tab.id, usage)}
          summaryUsage={summaryUsage}
          focusSession={focusSession}
          onOpenTab={openNewTab}
          onPrevTab={goToPreviousTab}
          onNextTab={goToNextTab}
          onJumpTab={jumpTab}
          onCloseTab={() => closeTabById(tab.id)}
          closeRequest={closeRequests[tab.id] ?? 0}
        />
      ))}
    </Box>
  )
}
