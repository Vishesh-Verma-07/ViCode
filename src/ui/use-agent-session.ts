import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useApp } from "ink"
import type { Command, CommandContext, Message, ModelSwitchResult, PickerRequest, ProviderOffering, ToolContext, ToolDefinition } from "../core/types"
import type { Session } from "../core/session"
import type { ModelListing, Provider, TokenUsage } from "../core/provider"
import type { ProviderId } from "../core/providers"
import { ensureCatalog, loadCatalogOffline, listCatalogModels } from "../core/catalog"
import { listProviders } from "../core/providers"
import { formatModelId, LEGACY_PROVIDER, parseModelId } from "../core/model-id"
import { runAgentLoop } from "../core/agent-loop"
import { addCost } from "../core/cost-calculator"
import { assembleSystemPrompt } from "../core/system-prompt"
import { DEFAULT_MODE, MODES, cycleMode as cycleModeId, findMode, selectModeTools, type ModeDefinition, type ModeId } from "../core/modes"
import { compactHistory } from "../core/compaction"
import { CommandRegistry } from "../core/command-registry"
import { dispatchCommand, getCommandName, isCommandAttempt } from "../core/command-dispatcher"
import { createSession, renameSession, saveSession } from "../core/session"
import { discoverSkills } from "../core/skills"
import { log } from "../utils/logger"
import { extractDiff } from "./format"
import { isPathApproved, approvePath, clearApprovedPaths } from "../core/approved-paths"
import { fileToolApprovalKey } from "../core/sensitive-files"
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

/**
 * Every Provider with the Models it offers, in registry order. Driven by the
 * Model Catalog rather than per-Provider listing endpoints, so one load fills
 * all five (ADR-0005).
 */
async function listOfferings(
  resolveKey: (provider: ProviderId) => string | undefined,
): Promise<ProviderOffering[]> {
  // Never block the picker on the network. Whatever is already known is shown
  // now; a refresh runs alongside and simply lands in time for next time.
  void ensureCatalog().catch(() => {
    // Offline: prices and context limits stay unknown rather than failing.
  })
  const catalog = loadCatalogOffline()
  return listProviders().map((descriptor) => ({
    provider: descriptor.id,
    label: descriptor.label,
    kind: descriptor.kind,
    billingNote: descriptor.billingNote,
    models: listCatalogModels(descriptor.id, catalog),
    hasKey: resolveKey(descriptor.id) !== undefined,
  }))
}

/**
 * The Model a Provider lands on when the current one is not offered there:
 * its cheapest paid model. Free models are skipped because a free tier is
 * rate-limited and, on some gateways, refuses third-party clients outright.
 * Unpriced models come last: they are last on the list anyway, and starting a
 * Provider on "we have no idea what this costs" is nobody's idea of a default.
 */
function defaultModelFor(offering: ProviderOffering): ModelListing | undefined {
  return (
    offering.models.find((m) => m.pricing.kind === "paid") ??
    offering.models.find((m) => m.pricing.kind === "free") ??
    offering.models[0]
  )
}

export interface UseAgentSessionArgs {
  provider: Provider
  tools: ToolDefinition[]
  projectPrompt?: string
  cliPrompt?: string
  context: ToolContext
  initialSession?: Session
  sessionsDir?: string
  commands?: Command[]
  openPicker: (request: PickerRequest) => Promise<number | null>
  resetDraft: () => void
  resetHistory: () => void
  view: "home" | "chat"
  enterChat: () => void
  enterHome: () => void
  /**
   * Resolves a Provider's key, consulting the environment as a fallback.
   * Injected so the session never reads config or `process.env` itself.
   */
  keyFor: (provider: ProviderId) => string | undefined
  createProvider?: (canonicalModelId: string, apiKey: string) => Provider
  ensureKeyFor?: (provider: ProviderId) => Promise<boolean>
  openKeyEntryFor?: (provider: ProviderId) => Promise<boolean>
  removeApiKeyFor?: (provider: ProviderId) => Promise<boolean>
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
  activeMode: ModeId
  activeModeDefinition: ModeDefinition
  cycleMode: () => void
  handleSend: (input: string) => Promise<void>
  startNewSession: () => void
  performExit: () => Promise<void>
  resolveApproval: (approved: boolean) => void
  requestExitSummary: () => void
  abortCurrent: () => void
  /** Records a newly-entered key for a Provider and rebuilds it. */
  applyApiKey: (provider: ProviderId, apiKey: string) => void
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
  projectPrompt,
  cliPrompt,
  context,
  initialSession,
  sessionsDir,
  commands,
  openPicker,
  resetDraft,
  resetHistory,
  view,
  enterChat,
  enterHome,
  keyFor,
  ensureKeyFor,
  openKeyEntryFor,
  removeApiKeyFor,
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
  const [activeMode, setActiveMode] = useState<ModeId>(initialSession?.mode ?? DEFAULT_MODE)
  const activeModeDefinition: ModeDefinition = findMode(activeMode) ?? MODES[0]!
  const cycleMode = useCallback(() => {
    setActiveMode((prev) => cycleModeId(prev))
  }, [])
  const abortRef = useRef<AbortController | null>(null)
  const activeTurnRef = useRef<Promise<void> | null>(null)
  const providerRef = useRef<Provider>(provider)
  /**
   * Keys as they stand at runtime. Seeded from `keyFor` (config plus
   * environment) and updated when a key is entered, so a Provider switch never
   * has to re-read either.
   */
  const keysRef = useRef<Partial<Record<ProviderId, string>>>({})
  const { exit } = useApp()

  const resolveKey = useCallback(
    (provider: ProviderId) => keysRef.current[provider] ?? keyFor(provider),
    [keyFor],
  )

  /** The active Provider, taken from the live provider's model info. */
  const currentProvider = useCallback((): ProviderId => {
    const info = providerRef.current.getModelInfo()
    if (info.provider) return info.provider
    return parseModelId(info.id).provider ?? LEGACY_PROVIDER
  }, [])

  /**
   * Asks for the key a switch (or `/key`) needs. The cancellable screen, not
   * the required one the pre-chat gate uses: walking into `/model` is not a
   * reason to hold the user on the API Key Entry Screen, and declining leaves
   * the route where it was for the Command to report.
   */
  const requestKeyFor = openKeyEntryFor ?? ensureKeyFor

  /**
   * Rebuilds the Provider from a canonical id. Refuses when the target
   * Provider has no key, so a route is never switched onto a credential that
   * does not exist — offering the key prompt first, and reporting which of the
   * two it was rather than leaving the caller to guess.
   */
  const switchTo = useCallback(
    async (canonicalModelId: string): Promise<ModelSwitchResult> => {
      if (!createProvider) {
        return { kind: "refused", reason: "ViCode cannot build a Provider here, so the model cannot be switched." }
      }
      const parsed = parseModelId(canonicalModelId)
      if (!parsed.provider) {
        return {
          kind: "refused",
          reason: `"${canonicalModelId}" is not a provider-qualified model id.`,
        }
      }

      if (!resolveKey(parsed.provider) && requestKeyFor) {
        const entered = await requestKeyFor(parsed.provider)
        if (!entered) return { kind: "needs-key", provider: parsed.provider }
      }
      // Read again: the prompt may have just stored one.
      const key = resolveKey(parsed.provider)
      if (!key) return { kind: "needs-key", provider: parsed.provider }

      const next = createProvider(canonicalModelId, key)
      providerRef.current = next
      setProviderState(next)
      return { kind: "switched", modelId: next.getModelInfo().id }
    },
    [createProvider, resolveKey, requestKeyFor],
  )

  useEffect(() => {
    providerRef.current = providerState
  }, [providerState])

  const applyApiKey = useCallback(
    (provider: ProviderId, nextApiKey: string) => {
      if (nextApiKey) {
        keysRef.current[provider] = nextApiKey
      } else {
        delete keysRef.current[provider]
      }
      if (!createProvider) return

      // A key only takes effect on the live route. Entering one for another
      // Provider stores it without moving the conversation — switching there is
      // what `/provider` and `/model` are for.
      if (currentProvider() !== provider) return

      const next = createProvider(providerRef.current.getModelInfo().id, resolveKey(provider) ?? "")
      providerRef.current = next
      setProviderState(next)
    },
    [createProvider, currentProvider, resolveKey],
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
    clearApprovedPaths()
    resetHistory()
    setSession(null)
    setMessages([])
    setToolCalls([])
    setUsage({ inputTokens: 0, outputTokens: 0, totalTokens: 0, cost: 0 })
    setTurnCount(0)
    setActiveSkills([])
    setActiveMode(DEFAULT_MODE)
  }, [resetHistory])

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

      const turnMode = activeModeDefinition

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
                clearApprovedPaths()
                setSession(loaded)
                setMessages(loaded.messages)
                setActiveMode(loaded.mode ?? DEFAULT_MODE)
                enterChat()
                setUsage({
                  inputTokens: 0,
                  outputTokens: 0,
                  totalTokens: loaded.totalTokens,
                  cost: loaded.totalCost,
                })
              },
              startFresh: clearSessionState,
              rename: (name) => {
                if (!session) return
                const renamed = renameSession(session, name)
                saveSession(renamed, sessionsDir)
                setSession(renamed)
              },
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
              listProviders: () => listOfferings(resolveKey),
              getCurrentModelId: () => providerRef.current.getModelInfo().id,
              getCurrentProvider: currentProvider,
              switchTo,
            }
          : undefined,
        providers: createProvider
          ? {
              list: () => listOfferings(resolveKey),
              getCurrent: currentProvider,
              switchTo: async (provider: ProviderId): Promise<ModelSwitchResult> => {
                const offering = (await listOfferings(resolveKey)).find((o) => o.provider === provider)
                if (!offering) return { kind: "refused", reason: `Unknown provider ${provider}.` }

                const parsed = parseModelId(providerRef.current.getModelInfo().id)
                const kept = offering.models.find((m) => m.id === parsed.model)
                const target = kept ?? defaultModelFor(offering)
                if (!target) {
                  return { kind: "refused", reason: `${offering.label} has no models ViCode can call.` }
                }

                return switchTo(formatModelId(provider, target.id))
              },
            }
          : undefined,
        skills: {
          list: async () => discoverSkills(context.projectPath),
        },
        compaction: sessionsDir
          ? {
              compact: async () => {
                setTurnStatus({ kind: "compacting" })
                try {
                  const result = await compactHistory(messages, providerRef.current)
                  if (result.foldedMessages === 0) {
                    return { foldedMessages: 0, foldedTokens: 0, summary: "" }
                  }

                  setMessages(result.messages)

                  if (result.usage && result.usage.totalTokens > 0) {
                    setUsage((prev) => ({
                      inputTokens: prev.inputTokens + result.usage!.inputTokens,
                      outputTokens: prev.outputTokens + result.usage!.outputTokens,
                      totalTokens: prev.totalTokens + result.usage!.totalTokens,
                      cost: addCost(prev.cost, result.usage!.cost),
                    }))
                  }

                  const base = session ?? createSession({
                    model: providerRef.current.getModelInfo().id,
                    messages: result.messages,
                  })
                  const savedSession: Session = {
                    ...base,
                    messages: result.messages,
                    model: providerRef.current.getModelInfo().id,
                    updatedAt: new Date().toISOString(),
                    totalTokens: base.totalTokens + (result.usage?.totalTokens ?? 0),
                    totalCost: addCost(base.totalCost, result.usage!.cost),
                    mode: activeMode,
                    lastCompaction: {
                      before: result.folded,
                      summary: result.summary,
                      at: new Date().toISOString(),
                    },
                  }
                  saveSession(savedSession, sessionsDir)
                  setSession(savedSession)

                  return {
                    foldedMessages: result.foldedMessages,
                    foldedTokens: result.foldedTokens,
                    summary: result.summary,
                  }
                } finally {
                  setTurnStatus({ kind: "idle" })
                }
              },
            }
          : undefined,
        key: requestKeyFor
          ? {
              set: (provider) => requestKeyFor(provider ?? currentProvider()),
              remove: (provider) =>
                (removeApiKeyFor ?? (async () => false))(provider ?? currentProvider()),
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

      if (ensureKeyFor) {
        const ok = await ensureKeyFor(currentProvider())
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
      clearApprovedPaths()
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
          const modePrompt = assembleSystemPrompt({
            projectPath: context.projectPath,
            projectPrompt,
            cliPrompt,
            skillPrompts: activeSkills,
            tools: selectModeTools(tools, turnMode.id),
          })
          const effectiveSystemPrompt = `${modePrompt}\n\n${turnMode.promptLayer}`
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
              onUsage: (stepUsage) => {
                setUsage((prev) => ({
                  inputTokens: prev.inputTokens + stepUsage.inputTokens,
                  outputTokens: prev.outputTokens + stepUsage.outputTokens,
                  totalTokens: prev.totalTokens + stepUsage.totalTokens,
                  cost: addCost(prev.cost, stepUsage.cost),
                }))
              },
              onCompactionStart: () => {
                setTurnStatus({ kind: "compacting" })
              },
              onCompactionEnd: () => {
                setTurnStatus({ kind: "thinking" })
              },
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
                const approvalKey = fileToolApprovalKey(toolName, args, context.projectPath)
                if (approvalKey && isPathApproved(approvalKey)) {
                  return Promise.resolve(true)
                }
                return new Promise<boolean>((resolveApproval) => {
                  setTurnStatus({ kind: "waiting-approval" })
                  setPendingApproval({
                    toolName,
                    args,
                    resolve: (approved) => {
                      if (approved && approvalKey) {
                        approvePath(approvalKey)
                      }
                      advanceToolStatus()
                      resolveApproval(approved)
                    },
                  })
                })
              },
            },
            controller.signal,
            turnMode,
          )

          log(result)

          setMessages(result.messages)

          if (sessionsDir) {
            const activeSession = session ?? createSession({
              model: providerRef.current.getModelInfo().id,
              messages: result.messages,
            })
            const savedSession: Session = {
              ...activeSession,
              messages: result.messages,
              model: providerRef.current.getModelInfo().id,
              updatedAt: new Date().toISOString(),
              totalTokens: activeSession.totalTokens + result.totalUsage.totalTokens,
              totalCost: addCost(activeSession.totalCost, result.totalUsage.cost),
              mode: turnMode.id,
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
    [messages, providerState, createProvider, tools, projectPrompt, cliPrompt, context, isStreaming, session, sessionsDir, commandRegistry, appendFeedback, openPicker, performExit, activeSkills, activeMode, view, enterChat, enterHome, resetDraft, clearSessionState, ensureKeyFor, openKeyEntryFor, currentProvider, switchTo, resolveKey],
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
    activeMode,
    activeModeDefinition,
    cycleMode,
    handleSend,
    startNewSession,
    performExit,
    resolveApproval,
    requestExitSummary,
    abortCurrent,
    applyApiKey,
  }
}
