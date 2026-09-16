import React, { useMemo } from "react"
import { Box, Text } from "ink"
import { COLORS, ICONS } from "./theme"
import { CodeFrame } from "./code-block"
import { parseDiff, type DiffLine } from "./diff"

interface DiffViewProps {
  diff: string
}

function lineKindColor(kind: DiffLine["kind"]): string {
  switch (kind) {
    case "add":
      return COLORS.success
    case "remove":
      return COLORS.error
    case "hunk":
      return COLORS.primary
    default:
      return COLORS.dimText
  }
}

function gutter(line: DiffLine, width: number): string {
  const pad = (n: number | null) => (n === null ? " ".repeat(width) : String(n).padStart(width, " "))
  return `${pad(line.oldLine)} ${pad(line.newLine)} │`
}

export function DiffView({ diff }: DiffViewProps) {
  const parsed = useMemo(() => parseDiff(diff), [diff])
  const path = parsed.newPath ?? parsed.oldPath ?? "(diff)"
  const maxNum = parsed.lines.reduce((acc, line) => Math.max(acc, line.oldLine ?? 0, line.newLine ?? 0), 0)
  const width = Math.max(1, String(maxNum).length)

  return (
    <Box flexDirection="column" marginBottom={1}>
      <Text color={COLORS.accent} bold>
        {ICONS.arrow} {path} <Text color={COLORS.success}>+{parsed.added}</Text> <Text color={COLORS.error}>-{parsed.removed}</Text>
      </Text>
      <CodeFrame>
        {parsed.lines.map((line, i) => (
          <Box key={i} flexDirection="row">
            <Text color={COLORS.dimText}>{gutter(line, width)}</Text>
            <Text color={lineKindColor(line.kind)}>{line.text || " "}</Text>
          </Box>
        ))}
      </CodeFrame>
    </Box>
  )
}