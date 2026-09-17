import React, { Fragment } from "react"
import { Text } from "ink"
import { COLORS } from "./theme"
import type { CodeSegment } from "../core/code-tokenizer"

interface InlineChipProps {
  text: string
}

export function InlineChip({ text }: InlineChipProps) {
  return (
    <Text backgroundColor={COLORS.inlineChipShade} color={COLORS.text}>
      {` ${text} `}
    </Text>
  )
}

interface InlineCodeTextProps {
  lines: CodeSegment[][]
  prefix?: string
  prefixColor?: string
}

export function InlineCodeText({ lines, prefix, prefixColor }: InlineCodeTextProps) {
  return (
    <Text wrap="wrap">
      {prefix && (
        <Text color={prefixColor} bold>
          {prefix}
        </Text>
      )}
      {lines.map((line, li) => (
        <Fragment key={li}>
          {line.map((seg, si) =>
            seg.kind === "inline-code" ? (
              <InlineChip key={si} text={seg.text} />
            ) : (
              <Text key={si}>{seg.text}</Text>
            ),
          )}
          {li < lines.length - 1 ? "\n" : null}
        </Fragment>
      ))}
    </Text>
  )
}