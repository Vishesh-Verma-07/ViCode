import { Box, Text } from "ink"
import { COLORS, ICONS } from "./theme"
import type { TokenUsage } from "../core/provider"
import { formatCost, formatTokens } from "../core/cost-calculator"
import type { RouteLabel } from "./route-label"

interface ExitSummaryProps {
  usage: TokenUsage
  route: RouteLabel
}

export function ExitSummary({ usage, route }: ExitSummaryProps) {
  return (
    <Box
      flexDirection="column"
      flexShrink={0}
      borderStyle="double"
      borderColor={COLORS.primary}
      paddingX={1}
      paddingY={1}
    >
      <Text color={COLORS.primary} bold>
        {ICONS.logo} Session Summary
      </Text>
      <Box marginTop={1}>
        <Text color={COLORS.text} bold>
          Model:{" "}
        </Text>
        <Text color={COLORS.muted}>{route}</Text>
      </Box>
      <Box marginTop={1}>
        <Text color={COLORS.text} bold>
          Tokens:{" "}
        </Text>
        <Text color={COLORS.muted}>
          {formatTokens(usage.totalTokens)} total ({formatTokens(usage.inputTokens)} in / {formatTokens(usage.outputTokens)} out)
        </Text>
      </Box>
      <Box marginTop={1}>
        <Text color={COLORS.text} bold>
          Cost:{" "}
        </Text>
        <Text color={usage.cost === null ? COLORS.muted : COLORS.success}>{formatCost(usage.cost)}</Text>
      </Box>
      <Box marginTop={1}>
        <Text color={COLORS.muted} italic>
          Press any key to exit
        </Text>
      </Box>
    </Box>
  )
}
