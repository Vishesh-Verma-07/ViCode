import React from "react"
import { Box, Text } from "ink"
import { COLORS } from "./theme"

interface CodeFrameProps {
  children: React.ReactNode
}

export function CodeFrame({ children }: CodeFrameProps) {
  return (
    <Box
      flexDirection="column"
      backgroundColor={COLORS.codeBlockShade}
      borderStyle="single"
      borderColor={COLORS.codeBlockBorder}
      paddingX={1}
    >
      {children}
    </Box>
  )
}

interface CodeBlockProps {
  code: string
  language?: string
  commandLine?: string
}

export function CodeBlock({ code, language, commandLine }: CodeBlockProps) {
  return (
    <Box flexDirection="column" marginBottom={1}>
      {language && <Text color={COLORS.dimText}>{language}</Text>}
      <CodeFrame>
        {commandLine && (
          <Text color={COLORS.primary} wrap="wrap">
            {"$ "}{commandLine}
          </Text>
        )}
        {(code || " ").split("\n").map((line, i) => (
          <Text key={i} color={COLORS.text} wrap="wrap">
            {line || " "}
          </Text>
        ))}
      </CodeFrame>
    </Box>
  )
}