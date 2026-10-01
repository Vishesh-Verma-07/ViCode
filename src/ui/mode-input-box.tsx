import type { ReactNode } from "react"
import { Box } from "ink"
import { COLORS } from "./theme"
import type { ModeDefinition } from "../core/modes"
import { ModeSwitcher } from "./mode-switcher"

interface ModeInputBoxProps {
  mode?: ModeDefinition
  children: ReactNode
  marginTop?: number
}

export function ModeInputBox({ mode, children, marginTop }: ModeInputBoxProps) {
  if (!mode) {
    return (
      <Box flexShrink={0} backgroundColor={COLORS.inputShade} marginTop={marginTop} paddingX={2} paddingY={1}>
        {children}
      </Box>
    )
  }
  const color = COLORS[mode.color]
  return (
    <Box flexDirection="row" flexShrink={0} backgroundColor={COLORS.inputShade} marginTop={marginTop}>
      <Box width={1} backgroundColor={color} />
      <Box flexDirection="column" flexGrow={1} flexShrink={0} paddingX={2} paddingY={1}>
        <ModeSwitcher mode={mode} />
        {children}
      </Box>
    </Box>
  )
}