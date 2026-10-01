import { Text } from "ink"
import { COLORS } from "./theme"
import { MODES, type ModeDefinition } from "../core/modes"
import { ModeTag } from "./mode-tag"

export function ModeSwitcher({ mode }: { mode: ModeDefinition }) {
  return (
    <Text>
      {MODES.map((candidate, index) => (
        <Text key={candidate.id}>
          {index > 0 ? " " : null}
          {candidate.id === mode.id ? (
            <ModeTag mode={candidate} />
          ) : (
            <Text color={COLORS.muted}>{candidate.name}</Text>
          )}
        </Text>
      ))}
    </Text>
  )
}
