import React from "react"
import { Box } from "ink"
import { COLORS } from "./theme"

interface CenteredOverlayProps {
  width: number
  height: number
  children: React.ReactNode
}

export function CenteredOverlay({ width, height, children }: CenteredOverlayProps) {
  return (
    <Box
      position="absolute"
      width={width}
      height={height}
      flexDirection="column"
      justifyContent="center"
      alignItems="center"
      backgroundColor={COLORS.appBackground}
    >
      {children}
    </Box>
  )
}