import { Box, Text } from "ink"
import { COLORS, ICONS } from "./theme"
import { ProjectRootPath } from "./project-root-path"
import type { TokenUsage } from "../core/provider"
import { formatCost, formatTokens, UNKNOWN_DISPLAY } from "../core/cost-calculator"
import type { TurnStatus } from "./status-bar"

interface UsagePanelProps {
  width: number
  model: string
  contextLength: number | null
  usage: TokenUsage
  turns: number
  status: TurnStatus
  projectRoot?: string
}

export function UsagePanel({ width, model, contextLength, usage, turns, status, projectRoot }: UsagePanelProps) {
  const contextPct =
    contextLength === null ? null : Math.min(100, (usage.totalTokens / contextLength) * 100)
  const contextValue =
    contextPct === null || contextLength === null
      ? UNKNOWN_DISPLAY
      : `${formatTokens(contextLength)} (${contextPct.toFixed(1)}%)`
  const contextColor =
    contextPct === null
      ? COLORS.muted
      : contextPct >= 80
        ? COLORS.error
        : contextPct >= 60
          ? COLORS.warning
          : COLORS.text
  return (
<Box width={width} flexDirection="column" flexGrow={1} backgroundColor={COLORS.usagePanelShade} paddingX={1}>
      <Box marginBottom={1}>
        <Text bold color={COLORS.primary}>
          {ICONS.sparkle} Usage
        </Text>
      </Box>
      <Box flexDirection="column" gap={0}>
        <Box justifyContent="space-between">
          <Text color={COLORS.muted}>Model:</Text>
          <Text color={COLORS.text}>{model}</Text>
        </Box>
        <Box justifyContent="space-between">
          <Text color={COLORS.muted}>Tokens:</Text>
          <Text color={COLORS.text}>{formatTokens(usage.totalTokens)}</Text>
        </Box>
        <Box justifyContent="space-between">
          <Text color={COLORS.dimText}>In:</Text>
          <Text color={COLORS.muted}>{formatTokens(usage.inputTokens)} / Out: {formatTokens(usage.outputTokens)}</Text>
        </Box>
        {/* Always present: an unmeasured window is information, and a row that
            appears and disappears makes its own absence unreadable. */}
        <Box justifyContent="space-between">
          <Text color={COLORS.muted}>Context:</Text>
          <Text color={contextColor}>{contextValue}</Text>
        </Box>
        <Box justifyContent="space-between">
          <Text color={COLORS.muted}>Cost:</Text>
          <Text color={usage.cost === null ? COLORS.muted : COLORS.success}>{formatCost(usage.cost)}</Text>
        </Box>
        <Box justifyContent="space-between">
          <Text color={COLORS.muted}>Turns:</Text>
          <Text color={COLORS.text}>{turns}</Text>
        </Box>
      </Box>
      <Box flexGrow={1} />
      <Box flexDirection="column" flexShrink={0}>
        {projectRoot ? (
          <Box>
            <ProjectRootPath projectRoot={projectRoot} />
          </Box>
        ) : null}
        <Box>
          <Text color={COLORS.dimText} italic>Ctrl+C to exit</Text>
        </Box>
      </Box>
    </Box>
  )
}
