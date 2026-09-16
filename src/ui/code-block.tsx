import React from "react"
import { Box, Text } from "ink"
import { COLORS } from "./theme"

interface CodeBlockProps {
  code: string
  language?: string
}

export function CodeBlock({ code, language }: CodeBlockProps) {
  return (
    <Box flexDirection="column" marginBottom={1}>
      {language && <Text color={COLORS.dimText}>{language}</Text>}
      <Box
        flexDirection="column"
        backgroundColor={COLORS.codeBlockShade}
        borderStyle="single"
        borderColor={COLORS.codeBlockBorder}
        paddingX={1}
      >
        {(code || " ").split("\n").map((line, i) => (
          <Text key={i} color={COLORS.text} wrap="wrap">
            {line || " "}
          </Text>
        ))}
      </Box>
    </Box>
  )
}