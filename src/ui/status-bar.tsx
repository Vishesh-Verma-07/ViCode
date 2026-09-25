import { Box, Text } from "ink"
import { Spinner, ThemeProvider, defaultTheme, extendTheme } from "@inkjs/ui"
import { COLORS, ICONS } from "./theme"
import type { TokenUsage } from "../core/provider"
import { formatCost, formatTokens } from "../core/cost-calculator"
import type { ModeDefinition } from "../core/modes"
import { ModeTag } from "./mode-tag"

export type TurnStatus =
  | { kind: "idle" }
  | { kind: "thinking" }
  | { kind: "working"; toolName: string }
  | { kind: "waiting-approval" }
  | { kind: "compacting" }
  | { kind: "done"; durationMs: number }
  | { kind: "error" }

function makeSpinnerTheme(color: string) {
  return extendTheme(defaultTheme, {
    components: { Spinner: { styles: { frame: () => ({ color }) } } },
  })
}

const yellowSpinnerTheme = makeSpinnerTheme(COLORS.warning)

const cyanSpinnerTheme = makeSpinnerTheme(COLORS.primary)

interface StatusBarProps {
  usage: TokenUsage
  model: string
  status: TurnStatus
  mode?: ModeDefinition
}

export function StatusBar({ usage, model, status, mode }: StatusBarProps) {
  return (
    <Box
      justifyContent="space-between"
      paddingX={1}
      flexShrink={0}
      backgroundColor={COLORS.statusBarShade}
    >
      <Box gap={2}>
        <Text color={COLORS.primary} bold>{ICONS.logo}</Text>
        {mode && <ModeTag mode={mode} />}
        <Text color={COLORS.muted}>
          {model}
        </Text>
        <StatusIndicator status={status} />
      </Box>
      <Text color={COLORS.muted}>
        Tokens: {formatTokens(usage.totalTokens)} | Cost: {formatCost(usage.cost)}
      </Text>
    </Box>
  )
}

export function StatusIndicator({ status }: { status: TurnStatus }) {
  switch (status.kind) {
    case "idle":
      return <Text color={COLORS.success}>{ICONS.check} Ready</Text>
    case "thinking":
      return (
        <ThemeProvider theme={yellowSpinnerTheme}>
          <Spinner label="Thinking…" />
        </ThemeProvider>
      )
    case "working":
      return (
        <ThemeProvider theme={cyanSpinnerTheme}>
          <Spinner label={`Working: ${status.toolName}…`} />
        </ThemeProvider>
      )
    case "waiting-approval":
      return <Text color={COLORS.warning}>{ICONS.warning} Waiting for approval</Text>
    case "compacting":
      return (
        <ThemeProvider theme={cyanSpinnerTheme}>
          <Spinner label="Compacting context…" />
        </ThemeProvider>
      )
    case "done":
      return <Text color={COLORS.success}>{ICONS.check} Done in {(status.durationMs / 1000).toFixed(1)}s</Text>
    case "error":
      return <Text color={COLORS.error}>{ICONS.cross} Error</Text>
  }
}
