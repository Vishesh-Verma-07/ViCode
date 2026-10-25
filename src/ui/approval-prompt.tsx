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

export interface ApprovalOption {
  decision: ApprovalDecision
  label: string
  color: string
}

function isBash(toolName: string): boolean {
  return toolName === "bash"
}

/**
 * The choices for a Tool Call, in the order the menu shows them. "Approve
 * once" comes first so Enter is the do-the-minimal-thing answer; "Always
 * approve" is second and only exists for bash, because a file approval already
 * lasts the Session and a grant would mean something different.
 */
export function approvalOptions(toolName: string): ApprovalOption[] {
  const options: ApprovalOption[] = [
    { decision: "once", label: "Approve once", color: COLORS.success },
  ]
  if (isBash(toolName)) {
    options.push({
      decision: "always",
      label: "Always approve this command",
      color: COLORS.primary,
    })
  }
  options.push({ decision: "reject", label: "Reject", color: COLORS.error })
  return options
}

interface ApprovalPromptProps {
  toolName: string
  args: Record<string, unknown>
  /** The highlighted choice; the App owns it so arrows and Enter share one index. */
  selected?: number
}

export function ApprovalPrompt({ toolName, args, selected = 0 }: ApprovalPromptProps) {
  const command = typeof args.command === "string" ? args.command : ""
  const cwd = typeof args.cwd === "string" ? args.cwd : ""
  const argsStr = isBash(toolName)
    ? ""
    : Object.keys(args).length > 0
      ? JSON.stringify(args, null, 2)
      : ""
  const options = approvalOptions(toolName)
  const highlighted = Math.min(Math.max(selected, 0), options.length - 1)

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
      <Box marginTop={1} flexDirection="column">
        {options.map((option, index) => {
          const active = index === highlighted
          return (
            <Text key={option.decision} bold={active}>
              <Text color={active ? COLORS.primary : COLORS.muted}>{active ? "❯ " : "  "}</Text>
              <Text color={active ? option.color : COLORS.muted}>{option.label}</Text>
            </Text>
          )
        })}
      </Box>
      <Box marginTop={1}>
        <Text color={COLORS.muted}>↑/↓ to choose · Enter to confirm</Text>
      </Box>
      {isBash(toolName) && (
        <Box marginTop={1}>
          <Text color={COLORS.muted}>
            Always approve remembers this exact command for this project. Review with /permissions.
          </Text>
        </Box>
      )}
    </Box>
  )
}
