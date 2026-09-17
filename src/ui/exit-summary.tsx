import { Box, Text } from "ink"
import { COLORS, ICONS } from "./theme"
import type { TokenUsage } from "../core/provider"
import { formatCost, formatTokens } from "../core/cost-calculator"

interface ExitSummaryProps {
  usage: TokenUsage
  model: string
}

export function ExitSummary({ usage, model }: ExitSummaryProps) {
  return (
    <Box
      flexDirection="column"
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
        <Text color={COLORS.muted}>{model}</Text>
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
        <Text color={COLORS.success}>{formatCost(usage.cost)}</Text>
      </Box>
      <Box marginTop={1}>
        <Text color={COLORS.muted} italic>
          Press any key to exit
        </Text>
      </Box>
    </Box>
  )
}
