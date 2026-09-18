import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useApp } from "ink"
import { resolve } from "path"
import type { Command, CommandContext, Message, PickerRequest, ToolContext, ToolDefinition } from "../core/types"
import type { Session } from "../core/session"
import type { Provider, TokenUsage } from "../core/provider"
import { runAgentLoop } from "../core/agent-loop"
import { CommandRegistry } from "../core/command-registry"
import { dispatchCommand, getCommandName, isCommandAttempt } from "../core/command-dispatcher"
import { createSession, saveSession } from "../core/session"
import { discoverSkills } from "../core/skills"
import { log } from "../utils/logger"
import { extractDiff } from "./format"
import type { FeedbackEntry, FeedbackTone } from "./feedback-line"
import type { PendingApproval } from "./approval-prompt"
import type { TurnStatus } from "./status-bar"

export const STREAMING_COMMAND_NOTICE = "Still responding - press Esc to stop it, or /exit to quit."

export interface ToolCallEntry {
  id: string
  name: string
  args: Record<string, unknown>
  result?: string
}

const DONE_REVERT_MS = 3000

export interface UseAgentSessionArgs {
  provider: Provider
  createProvider?: (modelId: string, apiKey?: string) => Provider
  tools: ToolDefinition[]
  systemPrompt: string
  context: ToolContext
  initialSession?: Session
  sessionsDir?: string
  commands?: Command[]
  openPicker: (request: PickerRequest) => Promise<number | null>
  resetDraft: () => void
  view: "home" | "chat"
  enterChat: () => void
  enterHome: () => void
  apiKey?: string
  ensureKey?: () => Promise<boolean>
  openKeyEntry?: () => Promise<boolean>
}

export interface AgentSession {
  messages: Message[]
  session: Session | null
  providerState: Provider
  isStreaming: boolean
  turnStatus: TurnStatus
  currentText: string
  toolCalls: ToolCallEntry[]
  usage: TokenUsage
  turnCount: number
  pendingApproval: PendingApproval | null
  showExitSummary: boolean
  feedbackEntries: FeedbackEntry[]
  activeSkills: string[]
  handleSend: (input: string) => Promise<void>
  startNewSession: () => void
  performExit: () => Promise<void>
  resolveApproval: (approved: boolean) => void
  requestExitSummary: () => void
  abortCurrent: () => void
  applyApiKey: (apiKey: string) => void
}

/**
 * Owns everything the agent does in the conversation: message history,
 * the active provider, one turn of streaming + tool execution, approvals,
 * usage accumulation, session persistence, and exit.
 */
export function useAgentSession({
  provider,
  createProvider,
  tools,
  systemPrompt,
  context,
  initialSession,
  sessionsDir,
  commands,
  openPicker,
  resetDraft,
  view,
  enterChat,
  enterHome,
  apiKey,
  ensureKey,
  openKeyEntry,
}: UseAgentSessionArgs): AgentSession {
  const [messages, setMessages] = useState<Message[]>(initialSession?.messages ?? [])
  const [session, setSession] = useState<Session | null>(initialSession ?? null)
  const [providerState, setProviderState] = useState<Provider>(provider)
  const [isStreaming, setIsStreaming] = useState(false)
  const [turnStatus, setTurnStatus] = useState<TurnStatus>({ kind: "idle" })
  const [currentText, setCurrentText] = useState("")
  const [toolCalls, setToolCalls] = useState<ToolCallEntry[]>([])
  const [usage, setUsage] = useState<TokenUsage>({ inputTokens: 0, outputTokens: 0, totalTokens: 0, cost: 0 })
  const [turnCount, setTurnCount] = useState(0)
  const [pendingApproval, setPendingApproval] = useState<PendingApproval | null>(null)
  const [showExitSummary, setShowExitSummary] = useState(false)
  const [feedbackEntries, setFeedbackEntries] = useState<FeedbackEntry[]>([])
  const [activeSkills, setActiveSkills] = useState<string[]>([])
  const abortRef = useRef<AbortController | null>(null)
  const activeTurnRef = useRef<Promise<void> | null>(null)
  const approvedPathsRef = useRef<Set<string>>(new Set())
  const providerRef = useRef<Provider>(provider)
  const apiKeyRef = useRef(apiKey ?? "")
  const { exit } = useApp()

  useEffect(() => {
    providerRef.current = providerState
  }, [providerState])

  const applyApiKey = useCallback(
    (nextApiKey: string) => {
      apiKeyRef.current = nextApiKey
      if (!createProvider) return
      const modelId = providerState.getModelInfo().id
      const next = createProvider(modelId, nextApiKey)
      providerRef.current = next
      setProviderState(next)
    },
    [createProvider, providerState],
  )

  useEffect(() => {
    if (turnStatus.kind !== "done") return
    const timer = setTimeout(() => setTurnStatus({ kind: "idle" }), DONE_REVERT_MS)
    return () => clearTimeout(timer)
  }, [turnStatus])

  const commandRegistry = useMemo(() => {
    const registry = new CommandRegistry()
    if (commands) registry.registerAll(commands)
    return registry
  }, [commands])

  const appendFeedback = useCallback((text: string, tone: FeedbackTone) => {
    setFeedbackEntries((prev) => [
      ...prev,
      { id: `feedback_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`, text, tone },
    ])
  }, [])

  const performExit = useCallback(async () => {
    abortRef.current?.abort()
    const turn = activeTurnRef.current
    if (turn) {
      try {
        await turn
      } catch {
        // The turn already reports its own errors; never let one block exiting.
      }
    }
    exit()
  }, [exit])

  const resolveApproval = useCallback((approved: boolean) => {
    pendingApproval?.resolve(approved)
    setPendingApproval(null)
  }, [pendingApproval])

  const requestExitSummary = useCallback(() => {
    setShowExitSummary(true)
  }, [])

  const abortCurrent = useCallback(() => {
    abortRef.current?.abort()
  }, [])

  const clearSessionState = useCallback(() => {
    approvedPathsRef.current.clear()
    setSession(null)
    setMessages([])
    setToolCalls([])
    setUsage({ inputTokens: 0, outputTokens: 0, totalTokens: 0, cost: 0 })
    setTurnCount(0)
    setActiveSkills([])
  }, [])

  const startNewSession = useCallback(() => {
    if (sessionsDir && session) {
      saveSession({ ...session, updatedAt: new Date().toISOString() }, sessionsDir)
    }
    clearSessionState()
    resetDraft()
    enterChat()
  }, [session, sessionsDir, clearSessionState, resetDraft, enterChat])

  const handleSend = useCallback(
    async (input: string) => {
      if (!input.trim()) return

      if (view === "home") {
        enterChat()
      }

      if (isStreaming) {
        if (!isCommandAttempt(input)) return
        if (getCommandName(input) !== "exit") {
          appendFeedback(STREAMING_COMMAND_NOTICE, "info")
          return
        }
      }

      setCurrentText("")
      resetDraft()
      setFeedbackEntries([])

      const commandContext: CommandContext = {
        projectPath: context.projectPath,
        openPicker,
        sessions: sessionsDir
          ? {
              dir: sessionsDir,
              getActiveSession: () => session,
              switchTo: (loaded) => {
                approvedPathsRef.current.clear()
                setSession(loaded)
                setMessages(loaded.messages)
                enterChat()
                setUsage({
                  inputTokens: 0,
                  outputTokens: 0,
                  totalTokens: loaded.totalTokens,
                  cost: loaded.totalCost,
                })
              },
              startFresh: clearSessionState,
            }
          : undefined,
        exit: {
          requestExit: () => performExit(),
        },
        navigation: {
          home: enterHome,
        },
        models: createProvider
          ? {
              list: () => providerRef.current.listModels(),
              getCurrentModelId: () => providerRef.current.getModelInfo().id,
              switchTo: (modelId) => {
                const next = createProvider(modelId, apiKeyRef.current)
                providerRef.current = next
                setProviderState(next)
              },
            }
          : undefined,
        skills: {
          list: async () => discoverSkills(context.projectPath),
        },
        key: openKeyEntry
          ? {
              set: () => openKeyEntry(),
            }
          : undefined,
        onSkillActivate: (content: string) => {
          setActiveSkills((prev) => {
            if (prev.some((s) => s === content)) return prev
            return [...prev, content]
          })
        },
      }
      const dispatch = await dispatchCommand(input, commandRegistry, commandContext)

      if (dispatch.kind !== "pass-through") {
        if (dispatch.kind === "executed") {
          if (dispatch.output) appendFeedback(dispatch.output, "info")
        } else {
          appendFeedback(dispatch.error, "error")
        }
        return
      }

      if (ensureKey) {
        const ok = await ensureKey()
        if (!ok) return
      }

      const userMsg: Message = {
        id: `user_${Date.now()}`,
        role: "user",
        content: [{ type: "text", text: input }],
        timestamp: Date.now(),
      }

      setMessages((prev) => [...prev, userMsg])
      setToolCalls([])
      setIsStreaming(true)
      setTurnStatus({ kind: "thinking" })

      const controller = new AbortController()
      abortRef.current = controller
      const turnStart = Date.now()
      let hadError = false
      let turnFailed = false
      const pendingToolNames: string[] = []
      const advanceToolStatus = () => {
        const nextTool = pendingToolNames[0]
        setTurnStatus(nextTool ? { kind: "working", toolName: nextTool } : { kind: "thinking" })
      }

      const turn = (async () => {
        try {
          const effectiveSystemPrompt = `${systemPrompt}\n\n${activeSkills.filter(
            (s) => s,
          ).join("\n\n")}`
          const result = await runAgentLoop(
            [...messages, userMsg],
            providerRef.current,
            tools,
            effectiveSystemPrompt,
            context,
            {
              onTextDelta: (text) => {
                setCurrentText((prev) => prev + text)
              },
              onToolCallStart: (id, name) => {
                pendingToolNames.push(name)
                advanceToolStatus()
                setToolCalls((prev) => [
                  ...prev,
                  { id, name, args: {} },
                ])
              },
              onToolCallDelta: () => {},
              onToolCallEnd: (id, _name, args) => {
                setToolCalls((prev) =>
                  prev.map((tc) =>
                    tc.id === id ? { ...tc, args } : tc,
                  ),
                )
              },
              onToolResult: (id, _name, result) => {
                pendingToolNames.shift()
                advanceToolStatus()
                const { message } = extractDiff(result)
                setToolCalls((prev) =>
                  prev.map((tc) =>
                    tc.id === id ? { ...tc, result: message } : tc,
                  ),
                )
              },
              onError: (error) => {
                hadError = true
                setTurnStatus({ kind: "error" })
                const detail =
                  error instanceof Error
                    ? error.message
                    : typeof error === "object" && error !== null && "message" in error
                      ? String((error as { message: unknown }).message)
                      : String(error)
                appendFeedback(`Model error: ${detail.slice(0, 200)}`, "error")
                console.error("Agent error:", error)
              },
              requestApproval: (toolName, args) => {
                const approvalKey =
                  toolName === "write_file" || toolName === "edit_file"
                    ? resolve(context.projectPath, String(args.path ?? ""))
                    : null
                if (approvalKey && approvedPathsRef.current.has(approvalKey)) {
                  return Promise.resolve(true)
                }
                return new Promise<boolean>((resolveApproval) => {
                  setTurnStatus({ kind: "waiting-approval" })
                  setPendingApproval({
                    toolName,
                    args,
                    resolve: (approved) => {
                      if (approved && approvalKey) {
                        approvedPathsRef.current.add(approvalKey)
                      }
                      advanceToolStatus()
                      resolveApproval(approved)
                    },
                  })
                })
              },
            },
            controller.signal,
          )

          log(result)

          setMessages(result.messages)
          setUsage((prev) => ({
            inputTokens: prev.inputTokens + result.totalUsage.inputTokens,
            outputTokens: prev.outputTokens + result.totalUsage.outputTokens,
            totalTokens: prev.totalTokens + result.totalUsage.totalTokens,
            cost: prev.cost + result.totalUsage.cost,
          }))

          if (sessionsDir) {
            const activeSession = session ?? createSession({
              projectPath: context.projectPath,
              model: providerRef.current.getModelInfo().name,
              messages: result.messages,
            })
            const savedSession: Session = {
              ...activeSession,
              messages: result.messages,
              model: providerRef.current.getModelInfo().name,
              updatedAt: new Date().toISOString(),
              totalTokens: activeSession.totalTokens + result.totalUsage.totalTokens,
              totalCost: activeSession.totalCost + result.totalUsage.cost,
            }
            saveSession(savedSession, sessionsDir)
            setSession(savedSession)
          }
        } catch (error) {
          turnFailed = !(error instanceof Error && error.name === "AbortError")
          if (turnFailed) {
            console.error("Loop error:", error)
          }
        } finally {
          setCurrentText("")
          setIsStreaming(false)
          abortRef.current = null
          if (!turnFailed && controller.signal.aborted) {
            setTurnStatus({ kind: "idle" })
          } else {
            setTurnCount((n) => n + 1)
            if (hadError || turnFailed) {
              setTurnStatus({ kind: "error" })
            } else {
              setTurnStatus({ kind: "done", durationMs: Date.now() - turnStart })
            }
          }
        }
      })()
      activeTurnRef.current = turn
      try {
        await turn
      } finally {
        if (activeTurnRef.current === turn) activeTurnRef.current = null
      }
    },
    [messages, providerState, createProvider, tools, systemPrompt, context, isStreaming, session, sessionsDir, commandRegistry, appendFeedback, openPicker, performExit, activeSkills, view, enterChat, enterHome, resetDraft, clearSessionState, ensureKey, openKeyEntry],
  )

  return {
    messages,
    session,
    providerState,
    isStreaming,
    turnStatus,
    currentText,
    toolCalls,
    usage,
    turnCount,
    pendingApproval,
    showExitSummary,
    feedbackEntries,
    activeSkills,
    handleSend,
    startNewSession,
    performExit,
    resolveApproval,
    requestExitSummary,
    abortCurrent,
    applyApiKey,
  }
}