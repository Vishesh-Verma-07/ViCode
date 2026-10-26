import { useCallback, useEffect, useRef, useState } from "react"
import { Box, useStdout, useWindowSize } from "ink"
import { MOUSE_TRACKING_ENABLE, MOUSE_TRACKING_DISABLE } from "./mouse"
import { COLORS } from "./theme"
import { TabHost, type TabHostDeps } from "./tab-host"
import { TAB_BAR_HEIGHT, TabBar } from "./tab-bar"
import {
  NEW_CHAT_TITLE,
  createTabSet,
  firstUserMessage,
  jumpToTab,
  nextTab,
  openTab,
  previousTab,
  setTabTitle,
  tabTitle,
  type TabSet,
} from "./tab-set"
import type { View } from "./view"

export { STREAMING_COMMAND_NOTICE } from "./use-agent-session"
export type { FeedbackTone, FeedbackEntry } from "./feedback-line"
export { FeedbackLine } from "./feedback-line"
export { StatusIndicator } from "./status-bar"
export { extractDiff } from "./format"

/**
 * The host the window starts with while the Welcome Screen is up. It is not a
 * Tab yet: the first message, or a new-Tab key, turns it into the first one, so
 * the Tab Bar never names a Tab that does not exist.
 */
const PRE_TAB_HOST_ID = "tab-pre"

interface AppProps extends TabHostDeps {
  initialView?: View
}

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
  // The resumed Session belongs to the host the window started with, wherever
  // it is: a Tab already, or still the pre-Tab draft on the Welcome Screen.
  const initialHostId = useRef<string>(tabs.activeId ?? PRE_TAB_HOST_ID)
  // The pre-Tab host is not in the set yet, so its title is kept here until it
  // becomes a Tab; otherwise a resumed Session's name would be lost on entry.
  const preTabTitle = useRef<string>(initialTitle ?? NEW_CHAT_TITLE)
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
    (state: TabSet) => openTab(state, { id: PRE_TAB_HOST_ID, title: preTabTitle.current }),
    [],
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
    if (id === PRE_TAB_HOST_ID) preTabTitle.current = title
    setTabs((previous) => setTabTitle(previous, id, title))
  }, [])

  // Before the first message there is no Tab, only the host that is about to
  // become one.
  const hosts = tabs.tabs.length > 0 ? tabs.tabs : [{ id: PRE_TAB_HOST_ID }]
  const activeId = tabs.activeId ?? PRE_TAB_HOST_ID
  // The Tab Bar is absent on the Welcome Screen, and takes exactly its row
  // from the panels when it is there.
  const showingBar = view === "chat" && tabs.tabs.length > 0
  const panelHeight = rows - (showingBar ? TAB_BAR_HEIGHT : 0)

  return (
    <Box flexDirection="column" width={columns} height={rows} backgroundColor={COLORS.appBackground}>
      {showingBar && (
        <TabBar
          width={columns}
          tabs={tabs.tabs.map((tab) => ({
            id: tab.id,
            title: tab.title,
            active: tab.id === activeId,
          }))}
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
          height={panelHeight}
          onEnterChat={enterChat}
          onEnterHome={enterHome}
          onTitleChange={(title) => setTitle(tab.id, title)}
          onOpenTab={openNewTab}
          onPrevTab={goToPreviousTab}
          onNextTab={goToNextTab}
          onJumpTab={jumpTab}
        />
      ))}
    </Box>
  )
}
