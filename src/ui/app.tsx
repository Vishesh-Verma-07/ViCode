import { useEffect, useState } from "react"
import { Box, useStdout, useWindowSize } from "ink"
import { MOUSE_TRACKING_ENABLE, MOUSE_TRACKING_DISABLE } from "./mouse"
import { COLORS } from "./theme"
import { TabHost, type TabHostDeps } from "./tab-host"
import type { View } from "./view"

export { STREAMING_COMMAND_NOTICE } from "./use-agent-session"
export type { FeedbackTone, FeedbackEntry } from "./feedback-line"
export { FeedbackLine } from "./feedback-line"
export { StatusIndicator } from "./status-bar"
export { extractDiff } from "./format"

interface AppProps extends TabHostDeps {
  initialView?: View
}

/**
 * The window. It owns the view (home or chat) and the mouse-tracking
 * lifecycle; each conversation lives in its own {@link TabHost}, which owns
 * the draft, transcript, Mode, Turn and overlays for that conversation.
 */
export function App({ initialView, ...hostProps }: AppProps) {
  const [view, setView] = useState<View>(
    initialView ?? (hostProps.initialSession ? "chat" : "home"),
  )
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

  return (
    <Box flexDirection="column" width={columns} height={rows} backgroundColor={COLORS.appBackground}>
      <TabHost
        {...hostProps}
        active
        view={view}
        width={columns}
        height={rows}
        onEnterChat={() => setView("chat")}
        onEnterHome={() => setView("home")}
      />
    </Box>
  )
}
