import { Box, Text } from "ink"
import { COLORS, ICONS } from "./theme"

/** What the user chose at the Approval Prompt. `always` is only offered for
 *  bash, where it persists a Command Grant for this Project. */
export type ApprovalDecision = "once" | "always" | "reject"

export interface PendingApproval {
  toolName: string
  args: Record<string, unknown>
  resolve: (decision: ApprovalDecision) => void
}

interface ApprovalPromptProps {
  toolName: string
  args: Record<string, unknown>
}

function isBash(toolName: string): boolean {
  return toolName === "bash"
}

export function ApprovalPrompt({ toolName, args }: ApprovalPromptProps) {
  const command = typeof args.command === "string" ? args.command : ""
  const cwd = typeof args.cwd === "string" ? args.cwd : ""
  const argsStr = isBash(toolName)
    ? ""
    : Object.keys(args).length > 0
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
      {isBash(toolName) && (
        <Box marginTop={1}>
          <Text color={COLORS.text}>{command}</Text>
        </Box>
      )}
      {isBash(toolName) && cwd && (
        <Box>
          <Text color={COLORS.muted}>in {cwd}</Text>
        </Box>
      )}
      {argsStr && (
        <Box marginTop={1}>
          <Text color={COLORS.text} bold>
            Args:{" "}
          </Text>
          <Text color={COLORS.muted} wrap="wrap">{argsStr}</Text>
        </Box>
      )}
      <Box marginTop={1} gap={2}>
        <Text>
          <Text color={COLORS.success}>[y]</Text>
          <Text color={COLORS.muted}> Approve once</Text>
        </Text>
        {isBash(toolName) && (
          <Text>
            <Text color={COLORS.primary}>[a]</Text>
            <Text color={COLORS.muted}> Always allow this command</Text>
          </Text>
        )}
        <Text>
          <Text color={COLORS.error}>[n]</Text>
          <Text color={COLORS.muted}> Reject</Text>
        </Text>
      </Box>
      {isBash(toolName) && (
        <Box marginTop={1}>
          <Text color={COLORS.muted}>
            Always allow remembers this exact command for this project. Review with /permissions.
          </Text>
        </Box>
      )}
    </Box>
  )
}
