import { Text } from "ink"
import { COLORS } from "./theme"
import type { ModeDefinition } from "../core/modes"

export function ModeTag({ mode }: { mode: ModeDefinition }) {
  return (
    <Text color={COLORS[mode.color]} bold>
      [{mode.name}]
    </Text>
  )
}