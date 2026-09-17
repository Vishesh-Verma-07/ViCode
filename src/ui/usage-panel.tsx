import { Box, Text } from "ink"
import { COLORS, ICONS } from "./theme"
import type { TokenUsage } from "../core/provider"
import { formatCost, formatTokens } from "../core/cost-calculator"
import type { TurnStatus } from "./status-bar"

interface UsagePanelProps {
  width: number
  model: string
  contextLength?: number
  usage: TokenUsage
  turns: number
  status: TurnStatus
}

export function UsagePanel({ width, model, contextLength, usage, turns, status }: UsagePanelProps) {
  const contextPct =
    contextLength && contextLength > 0
      ? Math.min(100, (usage.totalTokens / contextLength) * 100)
      : 0
  return (
    <Box width={width} flexDirection="column" borderStyle="single" borderColor={COLORS.border} paddingX={1}>
      <Box borderBottom={true} borderBottomColor={COLORS.border} paddingBottom={0} marginBottom={1}>
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
        {contextLength && contextLength > 0 && (
          <Box justifyContent="space-between">
            <Text color={COLORS.muted}>Context:</Text>
            <Text color={contextPct >= 80 ? COLORS.error : contextPct >= 60 ? COLORS.warning : COLORS.text}>
              {formatTokens(contextLength)} ({contextPct.toFixed(1)}%)
            </Text>
          </Box>
        )}
        <Box justifyContent="space-between">
          <Text color={COLORS.muted}>Cost:</Text>
          <Text color={COLORS.success}>{formatCost(usage.cost)}</Text>
        </Box>
        <Box justifyContent="space-between">
          <Text color={COLORS.muted}>Turns:</Text>
          <Text color={COLORS.text}>{turns}</Text>
        </Box>
      </Box>
      <Box marginTop={1} borderTop={true} borderTopColor={COLORS.border} paddingTop={0}>
        <Text color={COLORS.dimText} italic>Ctrl+C to exit</Text>
      </Box>
    </Box>
  )
}
