import { Box, Text } from "ink"
import { COLORS, ICONS } from "./theme"

export interface PendingApproval {
  toolName: string
  args: Record<string, unknown>
  resolve: (approved: boolean) => void
}

interface ApprovalPromptProps {
  toolName: string
  args: Record<string, unknown>
}

export function ApprovalPrompt({ toolName, args }: ApprovalPromptProps) {
  const argsStr = Object.keys(args).length > 0
    ? JSON.stringify(args, null, 2)
    : ""

  return (
    <Box
      flexDirection="column"
      flexShrink={0}
      borderStyle="double"
      borderColor={COLORS.warning}
      paddingX={1}
      paddingY={1}
    >
      <Text color={COLORS.warning} bold>
        {ICONS.warning} Tool Approval Required
      </Text>
      <Box marginTop={1}>
        <Text color={COLORS.text} bold>
          Tool:{" "}
        </Text>
        <Text color={COLORS.primary}>{toolName}</Text>
      </Box>
      {argsStr && (
        <Box marginTop={1}>
          <Text color={COLORS.text} bold>
            Args:{" "}
          </Text>
          <Text color={COLORS.muted} wrap="wrap">{argsStr}</Text>
        </Box>
      )}
      <Box marginTop={1}>
        <Text color={COLORS.success}>[y]</Text>
        <Text color={COLORS.muted}> Approve </Text>
        <Text color={COLORS.error}>[n]</Text>
        <Text color={COLORS.muted}> Reject</Text>
      </Box>
    </Box>
  )
}
