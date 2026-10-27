import { type Dispatch, type ReactNode, type SetStateAction, useEffect, useRef } from "react"
import { Box, Text, useInput } from "ink"
import { parseMouseEvents, parseWheelEvent } from "./mouse"
import { messageIdAtLine } from "./transcript-geometry"
import { COLORS, ICONS } from "./theme"
import type { Message, ContextSummaryContent } from "../core/types"
import { tokenizeCodeText, type CodeSegment } from "../core/code-tokenizer"
import { InlineCodeText } from "./inline-chip"
import { CodeBlock } from "./code-block"
import { DiffView } from "./diff-view"
import { CommandSuggestion, type CommandSuggestionProps } from "./command-suggestion"
import { FileSuggestion, type FileSuggestionProps } from "./file-suggestion"
import { FeedbackLine, type FeedbackEntry } from "./feedback-line"
import { ChatInput } from "./chat-input"
import { ModeInputBox } from "./mode-input-box"
import type { ModeDefinition } from "../core/modes"
import { extractDiff } from "./format"
import { UNKNOWN_ROUTE, type RouteLabel } from "./route-label"

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
  initialCursor?: number
  inputDisabled?: boolean
  onInputChange?: (value: string, cursor: number) => void
  /** Lines scrolled up from the bottom; owned by the conversation, not the panel. */
  scrollOffset: number
  onScrollOffsetChange: Dispatch<SetStateAction<number>>
  suggestion?: CommandSuggestionProps
  fileSuggestion?: FileSuggestionProps
  route?: RouteLabel
  mode?: ModeDefinition
  onTab?: () => void
  /** Set while Select Mode is picking messages to put on the clipboard. */
  selection?: MessageSelectionView
  /** Present in the chat view so a click or drag can name the message under it. */
  mouseSelection?: MouseSelectionHandlers
}

/** How the transcript reports pointer gestures to the conversation that owns Select Mode. */
export interface MouseSelectionHandlers {
  /** The panel's first screen row, 1-based, including the Tab Bar above it. */
  screenTop: number
  onPress: (messageId: string) => void
  onDrag: (messageId: string) => void
  onRelease: () => void
  /** One wheel notch while selecting: -1 is toward older messages. */
  onNudge: (delta: -1 | 1) => void
}

/** What ChatPanel needs to highlight the messages Select Mode is choosing between. */
export interface MessageSelectionView {
  activeId: string
  markedIds: ReadonlySet<string>
  /** 1-based position of the highlighted message. */
  position: number
  total: number
  markedCount: number
}

export const CHAT_CHROME_LINES = 6
/** The Select Mode hint bar: one line of text plus its bottom padding. */
export const SELECTION_FOOTER_LINES = 2
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

export function ChatPanel({ width, viewportHeight, scrollDisabled, runningTools, messages, currentText, isStreaming, onSend, feedbackEntries, inputKey, inputValue, initialCursor, inputDisabled, onInputChange, scrollOffset, onScrollOffsetChange, suggestion, fileSuggestion, route, mode, onTab, selection, mouseSelection }: ChatPanelProps) {
  useInput((_input, key) => {
    if (scrollDisabled) return
    const wheel = parseWheelEvent(_input)
    // While Select Mode is open the wheel walks the highlight instead of the
    // transcript, so the message being chosen cannot scroll out from under it.
    if (wheel && selection) return
    if (wheel === "up") {
      onScrollOffsetChange((offset) => offset + WHEEL_STEP_LINES)
    } else if (wheel === "down") {
      onScrollOffsetChange((offset) => Math.max(0, offset - WHEEL_STEP_LINES))
    } else if (key.pageUp) {
      onScrollOffsetChange((offset) => offset + viewportHeight)
    } else if (key.pageDown) {
      onScrollOffsetChange((offset) => Math.max(0, offset - viewportHeight))
    } else if (key.end) {
      onScrollOffsetChange(0)
    }
  })

  const usableWidth = Math.max(10, width - 6)
  const estimate = (text: string) => estimateLines(text, usableWidth)

  type Block = { key: string; lines: number; node: ReactNode; text?: string; messageId?: string }
  const blocks: Block[] = []

  const shadeFor = (messageId: string | undefined) => {
    if (!messageId || !selection) return undefined
    if (messageId === selection.activeId) return COLORS.selectionShade
    if (selection.markedIds.has(messageId)) return COLORS.selectionMarkedShade
    return undefined
  }

  const pushBlock = (key: string, node: ReactNode, lines: number, text?: string, messageId?: string) => {
    blocks.push({
      key,
      lines: lines + 1,
      text,
      messageId,
      node: (
        <Box key={key} flexDirection="column" marginBottom={1} backgroundColor={shadeFor(messageId)}>
          {node}
        </Box>
      ),
    })
  }

  const TEXT_CHUNK_LINES = 10

  const addCodeAwareBlocks = (
    keyBase: string,
    text: string,
    opts?: { prefix?: string; color?: "blue" | "green"; messageId?: string },
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
        pushBlock(
          key,
          node,
          estimate(usePrefix ? `${opts?.prefix ?? ""}${estimateText}` : estimateText),
          usePrefix ? `${opts?.prefix ?? ""}${plain}` : plain,
          opts?.messageId,
        )
      }
      firstTextDone = true
      mixed = []
    }

    for (const seg of segments) {
      if (seg.kind === "fenced") {
        flushMixed()
        nodeIdx++
        pushBlock(
          `${keyBase}:code${nodeIdx}`,
          <CodeBlock key={`${keyBase}:code${nodeIdx}`} code={seg.text} language={seg.language} />,
          estimate(seg.text) + (seg.language ? 1 : 0) + 4,
          seg.text,
          opts?.messageId,
        )
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
      const summaryParts = msg.content.filter(
        (c): c is ContextSummaryContent => c.type === "context-summary",
      )
      if (summaryParts.length > 0) {
        for (const part of summaryParts) {
          const header = `Context compacted — ${part.foldedMessages} messages folded`
          pushBlock(
            `${msg.id}:summary:head`,
            <Text key={`${msg.id}:summary:head`} color={COLORS.warning}>
              <Text color={COLORS.primary}>{ICONS.hourglass}</Text> {header}
            </Text>,
            1,
            header,
            msg.id,
          )
          addCodeAwareBlocks(`${msg.id}:summary:body`, part.summary, { messageId: msg.id })
        }
        continue
      }
      addCodeAwareBlocks(msg.id, textContentOf(msg), { prefix: "You: ", color: COLORS.accent, messageId: msg.id })
      for (const c of msg.content) {
        if (c.type !== "file-attachment") continue
        const lines = c.content.split("\n").length
        const label = `@${c.path} · ${lines} lines`
        pushBlock(
          `${msg.id}:attach:${c.path}`,
          <Text key={`${msg.id}:attach:${c.path}`} color={COLORS.muted}>
            <Text color={COLORS.accent}>@</Text>
            {c.path} <Text color={COLORS.dimText}>· {lines} lines</Text>
          </Text>,
          1,
          label,
          msg.id,
        )
      }
    } else if (msg.role === "assistant") {
      const text = textContentOf(msg)
      if (text) {
        addCodeAwareBlocks(msg.id, text, { prefix: "vicode: ", color: COLORS.success, messageId: msg.id })
      }
      for (const c of msg.content) {
        if (c.type !== "tool-call") continue
        pushBlock(
          `${msg.id}:call:${c.toolCallId}`,
          <Text key={`${msg.id}:call:${c.toolCallId}`} color={COLORS.muted}>
            <Text color={COLORS.primary}>{ICONS.tool}</Text> {c.toolName}
          </Text>,
          1,
          `${ICONS.tool} ${c.toolName}`,
          msg.id,
        )
      }
    } else if (msg.role === "tool") {
      for (const c of msg.content) {
        if (c.type !== "tool-result") continue
        const { diff, message } = extractDiff(c.result)
        if (diff) {
          const textLines = diff.split("\n").length
          pushBlock(
            `${msg.id}:result:${c.toolCallId}`,
            <DiffView key={`${msg.id}:result:${c.toolCallId}`} diff={diff} />,
            textLines + 5,
            undefined,
            msg.id,
          )
        } else {
          const summary = summarizeResult(message)
          const command = commandFromArgs(callArgsByToolCallId.get(c.toolCallId) ?? {})
          const key = `${msg.id}:result:${c.toolCallId}`
          pushBlock(
            key,
            <Box key={key} flexDirection="column">
              <Text color={COLORS.muted}>
                <Text color={COLORS.primary}>{ICONS.tool}</Text> {c.toolName}
              </Text>
              <CodeBlock key={`${key}:code`} code={summary.text} commandLine={command} />
            </Box>,
            1 + summary.lines + 4 + (command ? 1 : 0),
            command
              ? `${ICONS.tool} ${c.toolName}\n$ ${command}\n${summary.text}`
              : `${ICONS.tool} ${c.toolName}\n${summary.text}`,
            msg.id,
          )
        }
      }
    }
  }
  for (const tool of runningTools) {
    pushBlock(
      `running:${tool.id}`,
      <Text key={`running:${tool.id}`} color={COLORS.muted}>
        <Text color={COLORS.primary}>{ICONS.tool}</Text> {tool.name}…
      </Text>,
      1,
      `${ICONS.tool} ${tool.name}…`,
    )
  }
  for (const entry of feedbackEntries) {
    pushBlock(
      entry.id,
      <FeedbackLine key={entry.id} text={entry.text} tone={entry.tone} />,
      estimate(entry.text),
      entry.text,
    )
  }
  if (currentText) {
    addCodeAwareBlocks("current-stream", currentText)
  }

  const totalLines = blocks.reduce((n, b) => n + b.lines, 0)
  const maxScroll = Math.max(0, totalLines - viewportHeight + 1)
  const offset = Math.min(scrollOffset, maxScroll)
  const hintLines = offset > 0 ? 1 : 0

  const blockStarts: number[] = []
  let runningLines = 0
  for (const block of blocks) {
    blockStarts.push(runningLines)
    runningLines += block.lines
  }

  // Pointer state is not rendered, so a ref keeps a drag from re-rendering the
  // transcript on every cell the pointer crosses.
  const pointer = useRef<{ dragging: boolean; lastMessageId: string | null }>({
    dragging: false,
    lastMessageId: null,
  })

  useInput((input) => {
    if (!mouseSelection || scrollDisabled) return
    const events = parseMouseEvents(input)
    if (events.length === 0) return

    const hintRows = offset > 0 ? 1 : 0
    const budget = viewportHeight - hintRows
    const topLine = Math.max(0, totalLines - offset - budget)
    const firstContentRow = mouseSelection.screenTop + 1 + hintRows
    const messageAt = (column: number, row: number): string | undefined => {
      if (column < 1 || column > width) return undefined
      const contentRow = row - firstContentRow
      if (contentRow < 0 || contentRow >= budget) return undefined
      return messageIdAtLine(blocks, topLine + contentRow)
    }

    for (const event of events) {
      if (event.button === "wheel-up" || event.button === "wheel-down") {
        if (event.kind === "press") {
          mouseSelection.onNudge(event.button === "wheel-up" ? -1 : 1)
        }
        continue
      }
      if (event.button !== "left") continue

      if (event.kind === "press") {
        const messageId = messageAt(event.column, event.row)
        pointer.current.dragging = messageId !== undefined
        pointer.current.lastMessageId = messageId ?? null
        if (messageId) mouseSelection.onPress(messageId)
      } else if (event.kind === "move") {
        if (!pointer.current.dragging) continue
        const messageId = messageAt(event.column, event.row)
        if (!messageId || messageId === pointer.current.lastMessageId) continue
        pointer.current.lastMessageId = messageId
        mouseSelection.onDrag(messageId)
      } else {
        if (!pointer.current.dragging) continue
        pointer.current.dragging = false
        pointer.current.lastMessageId = null
        mouseSelection.onRelease()
      }
    }
  })

  // Bring the highlighted message into view as Select Mode moves through the
  // transcript, without hard-coding transcript geometry anywhere else.
  useEffect(() => {
    if (!selection) return
    const first = blocks.findIndex((block) => block.messageId === selection.activeId)
    if (first < 0) return
    const start = blockStarts[first] ?? 0
    let end = start
    for (let i = first; i < blocks.length && blocks[i]?.messageId === selection.activeId; i++) {
      end += blocks[i]!.lines
    }

    const budget = Math.max(1, viewportHeight - hintLines)
    const visibleTop = totalLines - offset - budget
    const visibleBottom = totalLines - offset
    const setOffset = (next: number) => {
      const clamped = Math.max(0, Math.min(maxScroll, next))
      if (clamped !== scrollOffset) onScrollOffsetChange(clamped)
    }

    // A message taller than the viewport cannot show both edges; keep its top
    // visible rather than oscillating between the two corrections.
    if (end - start > budget) {
      if (start < visibleTop || start >= visibleBottom) setOffset(totalLines - start - budget)
      return
    }
    if (start < visibleTop) setOffset(totalLines - start - budget)
    else if (end > visibleBottom) setOffset(totalLines - end)
  }, [selection?.activeId, scrollOffset, viewportHeight, totalLines])

  const sliceBlockText = (block: Block, count: number, mode: "head" | "tail"): ReactNode => {
    if (block.text === undefined) return block.node
    const linesArr = block.text.split("\n")
    const sliced = mode === "head" ? linesArr.slice(0, count) : linesArr.slice(-count)
    return (
      <Box key={`${block.key}:slice`} backgroundColor={shadeFor(block.messageId)}>
        <Text>{sliced.join("\n")}</Text>
      </Box>
    )
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
      backgroundColor={COLORS.panelShade}
      paddingTop={1}
    >
      <Box flexGrow={1} flexDirection="column" overflow="hidden" paddingX={2}>
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
                Model: <Text color={COLORS.text}>{route ?? UNKNOWN_ROUTE}</Text>
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
        <Box paddingBottom={1} paddingX={2}>
          <CommandSuggestion {...suggestion} />
        </Box>
      )}
      {fileSuggestion && (
        <Box paddingBottom={1} paddingX={2}>
          <FileSuggestion {...fileSuggestion} />
        </Box>
      )}
      {selection && (
        <Box paddingBottom={1} paddingX={2}>
          <Text color={COLORS.muted} wrap="truncate-end">
            <Text color={COLORS.primary}>{ICONS.dot}</Text> Select message {selection.position}/{selection.total}
            {selection.markedCount > 0 && (
              <Text color={COLORS.success}> · {selection.markedCount} selected</Text>
            )}
            <Text color={COLORS.dimText}> · Drag or Space select · Enter copy · Esc cancel</Text>
          </Text>
        </Box>
      )}
      <ModeInputBox mode={mode} marginTop={1}>
        <ChatInput
          value={inputValue}
          initialCursor={initialCursor}
          placeholder={
            selection ? "Selecting messages..." : isStreaming ? "Responding..." : "Type your message..."
          }
          isDisabled={inputDisabled}
          onChange={onInputChange ?? (() => {})}
          onTab={onTab}
        />
      </ModeInputBox>
    </Box>
  )
}
