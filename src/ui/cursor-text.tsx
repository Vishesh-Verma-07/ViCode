import { Text } from "ink"
import { COLORS, ICONS } from "./theme"

interface CursorTextProps {
  value: string
  cursor: number
  placeholder: string
  disabled?: boolean
  placeholderItalic?: boolean
}

export function CursorText({ value, cursor, placeholder, disabled = false, placeholderItalic = false }: CursorTextProps) {
  const c = Math.max(0, Math.min(cursor, value.length))
  return (
    <Text>
      <Text color={COLORS.primary} bold>{ICONS.arrow} </Text>
      {value.length === 0 ? (
        <Text color={COLORS.muted} italic={placeholderItalic}>{placeholder}</Text>
      ) : (
        <Text>
          <Text>{value.slice(0, c)}</Text>
          {!disabled && <Text inverse> </Text>}
          <Text>{value.slice(c)}</Text>
        </Text>
      )}
      {value.length === 0 && !disabled && <Text inverse> </Text>}
    </Text>
  )
}