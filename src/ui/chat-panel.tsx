import { useState, type ReactNode } from "react"
import { Box, Text, useInput } from "ink"
import { parseWheelEvent } from "./mouse"
import { COLORS, ICONS } from "./theme"
import type { Message } from "../core/types"
import { tokenizeCodeText, type CodeSegment } from "../core/code-tokenizer"
import { InlineCodeText } from "./inline-chip"
import { CodeBlock } from "./code-block"
import { DiffView } from "./diff-view"
import { CommandSuggestion, type CommandSuggestionProps } from "./command-suggestion"
import { FeedbackLine, type FeedbackEntry } from "./feedback-line"
import { ChatInput } from "./chat-input"
import { extractDiff } from "./format"

interface ChatPanelProps {
  width: number
  viewportHeight: number
  scrollDisabled?: boolean
  runningTools: Array<{ id: string; name: string }>
  messages: Message[]
  currentText: string
  isStreaming: boolean
  onSend: (input: string) => void
  feedbackEntries: FeedbackEntry[]
  inputKey: number
  inputValue: string
  inputDisabled?: boolean
  onInputChange?: (value: string) => void
  suggestion?: CommandSuggestionProps
  modelName?: string
}

export const CHAT_CHROME_LINES = 7
const WHEEL_STEP_LINES = 3

function textContentOf(msg: Message): string {
  return msg.content
    .filter((c) => c.type === "text")
    .map((c) => (c.type === "text" ? c.text : ""))
    .join("")
}

function estimateLines(text: string, usableWidth: number): number {
  return text
    .split("\n")
    .reduce((n, seg) => n + Math.max(1, Math.ceil(seg.length / usableWidth)), 0)
}

const RESULT_SUMMARY_LINES = 3

function summarizeResult(result: string): { text: string; lines: number } {
  const lines = result.replace(/\n+$/, "").split("\n")
  if (lines.length <= RESULT_SUMMARY_LINES + 1) {
    return { text: lines.join("\n"), lines: Math.max(1, lines.length) }
  }
  const head = lines.slice(0, RESULT_SUMMARY_LINES)
  return { text: `${head.join("\n")}\n… +${lines.length - RESULT_SUMMARY_LINES} more lines`, lines: RESULT_SUMMARY_LINES + 1 }
}

function commandFromArgs(args: Record<string, unknown>): string | undefined {
  const command = args["command"]
  if (typeof command === "string") {
    const trimmed = command.trim()
    return trimmed ? trimmed : undefined
  }
  return undefined
}

export function ChatPanel({ width, viewportHeight, scrollDisabled, runningTools, messages, currentText, isStreaming, onSend, feedbackEntries, inputKey, inputValue, inputDisabled, onInputChange, suggestion, modelName }: ChatPanelProps) {
  const [bottomOffset, setBottomOffset] = useState(0)

  useInput((_input, key) => {
    if (scrollDisabled) return
    const wheel = parseWheelEvent(_input)
    if (wheel === "up") {
      setBottomOffset((prev) => prev + WHEEL_STEP_LINES)
    } else if (wheel === "down") {
      setBottomOffset((prev) => Math.max(0, prev - WHEEL_STEP_LINES))
    } else if (key.pageUp) {
      setBottomOffset((prev) => prev + viewportHeight)
    } else if (key.pageDown) {
      setBottomOffset((prev) => Math.max(0, prev - viewportHeight))
    } else if (key.end) {
      setBottomOffset(0)
    }
  })

  const usableWidth = Math.max(10, width - 6)
  const estimate = (text: string) => estimateLines(text, usableWidth)

  type Block = { key: string; lines: number; node: ReactNode; text?: string }
  const blocks: Block[] = []

  const TEXT_CHUNK_LINES = 10

  const addCodeAwareBlocks = (
    keyBase: string,
    text: string,
    opts?: { prefix?: string; color?: "blue" | "green" },
  ) => {
    const segments = tokenizeCodeText(text)
    let nodeIdx = 0
    let textIdx = 0
    let firstTextDone = false
    let mixed: CodeSegment[] = []

    const splitMixedLines = (run: CodeSegment[]): CodeSegment[][] => {
      const lines: CodeSegment[][] = []
      let current: CodeSegment[] = []
      for (const seg of run) {
        const parts = seg.text.split("\n")
        for (let p = 0; p < parts.length; p++) {
          if (p > 0) {
            lines.push(current)
            current = []
          }
          const part = parts[p]!
          if (part) current.push(part === seg.text ? seg : { ...seg, text: part })
        }
      }
      lines.push(current)
      return lines
    }

    const flushMixed = () => {
      if (mixed.length === 0) return
      const lines = splitMixedLines(mixed)
      const padded = (seg: CodeSegment) => (seg.kind === "inline-code" ? ` ${seg.text} ` : seg.text)
      for (let i = 0; i < lines.length; i += TEXT_CHUNK_LINES) {
        const chunkLines = lines.slice(i, i + TEXT_CHUNK_LINES)
        textIdx++
        const key = `${keyBase}:t${textIdx}`
        const usePrefix = i === 0 && !firstTextDone && opts?.prefix
        const node = (
          <InlineCodeText
            key={key}
            lines={chunkLines}
            prefix={usePrefix ? opts?.prefix : undefined}
            prefixColor={usePrefix ? opts?.color : undefined}
          />
        )
        const plain = chunkLines.map((line) => line.map((s) => s.text).join("")).join("\n")
        const estimateText = chunkLines.map((line) => line.map(padded).join("")).join("\n")
        blocks.push({
          key,
          lines: estimate(usePrefix ? `${opts?.prefix ?? ""}${estimateText}` : estimateText),
          text: usePrefix ? `${opts?.prefix ?? ""}${plain}` : plain,
          node,
        })
      }
      firstTextDone = true
      mixed = []
    }

    for (const seg of segments) {
      if (seg.kind === "fenced") {
        flushMixed()
        nodeIdx++
        blocks.push({
          key: `${keyBase}:code${nodeIdx}`,
          lines: estimate(seg.text) + (seg.language ? 1 : 0) + 2,
          text: seg.text,
          node: <CodeBlock key={`${keyBase}:code${nodeIdx}`} code={seg.text} language={seg.language} />,
        })
      } else {
        mixed.push(seg)
      }
    }
    flushMixed()
  }

  const callArgsByToolCallId = new Map<string, Record<string, unknown>>()
  for (const msg of messages) {
    if (msg.role !== "assistant") continue
    for (const c of msg.content) {
      if (c.type === "tool-call") callArgsByToolCallId.set(c.toolCallId, c.args)
    }
  }

  for (const msg of messages) {
    if (msg.role === "user") {
      addCodeAwareBlocks(msg.id, textContentOf(msg), { prefix: "You: ", color: COLORS.accent })
    } else if (msg.role === "assistant") {
      const text = textContentOf(msg)
      if (text) {
        addCodeAwareBlocks(msg.id, text, { prefix: "vicode: ", color: COLORS.success })
      }
      for (const c of msg.content) {
        if (c.type !== "tool-call") continue
        blocks.push({
          key: `${msg.id}:call:${c.toolCallId}`,
          lines: 1,
          node: (
            <Text key={`${msg.id}:call:${c.toolCallId}`} color={COLORS.muted}>
              <Text color={COLORS.primary}>{ICONS.tool}</Text> {c.toolName}
            </Text>
          ),
          text: `${ICONS.tool} ${c.toolName}`,
        })
      }
    } else if (msg.role === "tool") {
      for (const c of msg.content) {
        if (c.type !== "tool-result") continue
        const { diff, message } = extractDiff(c.result)
        if (diff) {
          const lines = diff.split("\n").length
          blocks.push({
            key: `${msg.id}:result:${c.toolCallId}`,
            lines,
            node: <DiffView key={`${msg.id}:result:${c.toolCallId}`} diff={diff} />,
          })
        } else {
          const summary = summarizeResult(message)
          const command = commandFromArgs(callArgsByToolCallId.get(c.toolCallId) ?? {})
          const key = `${msg.id}:result:${c.toolCallId}`
          blocks.push({
            key,
            lines: 1 + summary.lines + 2 + (command ? 1 : 0),
            node: (
              <Box key={key} flexDirection="column">
                <Text color={COLORS.muted}>
                  <Text color={COLORS.primary}>{ICONS.tool}</Text> {c.toolName}
                </Text>
                <CodeBlock key={`${key}:code`} code={summary.text} commandLine={command} />
              </Box>
            ),
            text: command
              ? `${ICONS.tool} ${c.toolName}\n$ ${command}\n${summary.text}`
              : `${ICONS.tool} ${c.toolName}\n${summary.text}`,
          })
        }
      }
    }
  }
  for (const tool of runningTools) {
    blocks.push({
      key: `running:${tool.id}`,
      lines: 1,
      node: (
        <Text key={`running:${tool.id}`} color={COLORS.muted}>
          <Text color={COLORS.primary}>{ICONS.tool}</Text> {tool.name}…
        </Text>
      ),
      text: `${ICONS.tool} ${tool.name}…`,
    })
  }
  for (const entry of feedbackEntries) {
    blocks.push({
      key: entry.id,
      lines: estimate(entry.text) + 1,
      node: <FeedbackLine key={entry.id} text={entry.text} tone={entry.tone} />,
      text: entry.text,
    })
  }
  if (currentText) {
    addCodeAwareBlocks("current-stream", currentText)
  }

  const totalLines = blocks.reduce((n, b) => n + b.lines, 0)
  const maxScroll = Math.max(0, totalLines - viewportHeight + 1)
  const offset = Math.min(bottomOffset, maxScroll)
  const hintLines = offset > 0 ? 1 : 0

  const sliceBlockText = (block: Block, count: number, mode: "head" | "tail"): ReactNode => {
    if (block.text === undefined) return block.node
    const linesArr = block.text.split("\n")
    const sliced = mode === "head" ? linesArr.slice(0, count) : linesArr.slice(-count)
    return <Text key={`${block.key}:slice`}>{sliced.join("\n")}</Text>
  }

  let skip = offset
  let budget = viewportHeight - hintLines
  const visibleNodes: ReactNode[] = []
  for (let i = blocks.length - 1; i >= 0 && budget > 0; i--) {
    const block = blocks[i]!
    if (skip > 0) {
      if (block.lines <= skip) {
        skip -= block.lines
        continue
      }
      const show = Math.min(block.lines - skip, budget)
      visibleNodes.unshift(sliceBlockText(block, show, "head"))
      budget -= show
      skip = 0
      continue
    }
    const fit = Math.min(block.lines, budget)
    if (fit < block.lines) {
      visibleNodes.unshift(sliceBlockText(block, fit, "tail"))
    } else {
      visibleNodes.unshift(block.node)
    }
    budget -= fit
  }

  return (
    <Box
      width={width}
      flexDirection="column"
      borderStyle="single"
      borderColor={COLORS.border}
      paddingX={1}
    >
      <Box flexGrow={1} flexDirection="column" overflow="hidden">
        {blocks.length === 0 && (
          <Box flexDirection="column" alignItems="center" justifyContent="center" flexGrow={1}>
            <Text color={COLORS.primary} bold>
              {ICONS.logo} ViCode
            </Text>
            <Box marginTop={0}>
              <Text color={COLORS.muted}>
                AI-Powered Coding Assistant
              </Text>
            </Box>
            <Box marginTop={1}>
              <Text color={COLORS.dimText}>
                Model: <Text color={COLORS.text}>{modelName ?? "unknown"}</Text>
              </Text>
            </Box>
            <Box marginTop={1}>
              <Text color={COLORS.muted}>
                Type a message to start chatting...
              </Text>
            </Box>
          </Box>
        )}
        {offset > 0 && (
          <Text color={COLORS.muted}>↑ {offset} lines — End to return</Text>
        )}
        {visibleNodes}
      </Box>
      {suggestion && (
        <Box paddingBottom={1}>
          <CommandSuggestion
            items={suggestion.items}
            highlightIndex={suggestion.highlightIndex}
          />
        </Box>
      )}
      <Box borderTop={true} borderTopColor={COLORS.border} paddingTop={1}>
        <ChatInput
          value={inputValue}
          placeholder={isStreaming ? "Responding..." : "Type your message..."}
          isDisabled={inputDisabled}
          onChange={onInputChange ?? (() => {})}
        />
      </Box>
    </Box>
  )
}
