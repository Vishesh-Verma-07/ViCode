import type { ReactNode } from "react"
import { Box } from "ink"
import { COLORS } from "./theme"
import type { ModeDefinition } from "../core/modes"
import { ModeTag } from "./mode-tag"

interface ModeInputBoxProps {
  mode?: ModeDefinition
  children: ReactNode
  marginTop?: number
}

export function ModeInputBox({ mode, children, marginTop }: ModeInputBoxProps) {
  if (!mode) {
    return (
      <Box backgroundColor={COLORS.inputShade} marginTop={marginTop} paddingX={2} paddingY={1}>
        {children}
      </Box>
    )
  }
  const color = COLORS[mode.color]
  return (
    <Box flexDirection="row" backgroundColor={COLORS.inputShade} marginTop={marginTop}>
      <Box width={2} backgroundColor={color} />
      <Box flexDirection="column" flexGrow={1} paddingX={2} paddingY={1}>
        <ModeTag mode={mode} />
        {children}
      </Box>
    </Box>
  )
}