import type { z } from "zod"
import type { ModelListing } from "./provider"
import type { ProviderId, ProviderKind } from "./providers"
import type { Skill } from "./skills"
import type { ModeId } from "./modes"

export type Role = "user" | "assistant" | "system" | "tool"

export interface TextContent {
  type: "text"
  text: string
}

export interface ToolCallContent {
  type: "tool-call"
  toolCallId: string
  toolName: string
  args: Record<string, unknown>
}

export interface ToolResultContent {
  type: "tool-result"
  toolCallId: string
  toolName: string
  result: string
  isError?: boolean
}

export interface ContextSummaryContent {
  type: "context-summary"
  summary: string
  foldedMessages: number
  foldedTokens: number
  at: number
}

export type Content = TextContent | ToolCallContent | ToolResultContent | ContextSummaryContent

export interface Message {
  id: string
  role: Role
  content: Content[]
  timestamp: number
}

export interface ToolDefinition {
  name: string
  description: string
  parameters: z.ZodObject<z.ZodRawShape>
  execute: (args: Record<string, unknown>, context: ToolContext) => Promise<string>
  dangerous: boolean
  requiresApproval?: (args: Record<string, unknown>, context: ToolContext) => boolean | Promise<boolean>
}

export interface ToolContext {
  projectPath: string
  sensitivePatterns?: string[]
  silentBashCommands?: string[]
}

export interface Command {
  name: string
  description: string
  usage?: string
  execute: (args: string[], context: CommandContext) => Promise<string>
}

export interface PickerItem {
  label: string
  metadata?: string
}

export interface PickerRequest {
  title: string
  items: PickerItem[]
  defaultIndex?: number
  hint?: string
}

export type OpenPicker = (request: PickerRequest) => Promise<number | null>

export interface SessionsCapability {
  dir: string
  getActiveSession(): Session | null
  switchTo(session: Session): void
  startFresh(): void
  rename(name: string | null): void
}

export interface ExitCapability {
  requestExit(): Promise<void>
}

export interface NavigationCapability {
  home(): void
}

export interface ModelsCapability {
  /** Every Provider and the Models it offers, grouped for display. */
  listProviders(): Promise<ProviderOffering[]>
  /** The active canonical `provider/model` id. */
  getCurrentModelId(): string
  getCurrentProvider(): ProviderId
  /** Switches route and model in one step. The id must be provider-qualified. */
  switchTo(canonicalModelId: string): void
}

export interface ProviderOffering {
  provider: ProviderId
  label: string
  kind: ProviderKind
  billingNote?: string
  models: ModelListing[]
  /** Whether a key is configured for this Provider. A missing key never hides
   *  its Models — switching to it prompts for one instead. */
  hasKey: boolean
}

export interface ProvidersCapability {
  list(): Promise<ProviderOffering[]>
  getCurrent(): ProviderId
  /** Switches Provider, keeping the current Model when that Provider offers
   *  it and otherwise moving to the Provider's top-ranked Model. */
  switchTo(provider: ProviderId): Promise<string | null>
}

export interface KeyCapability {
  /** Defaults to the active Provider. */
  set(provider?: ProviderId): Promise<boolean>
  /** Defaults to the active Provider. */
  remove(provider?: ProviderId): Promise<boolean>
}

export interface SkillContext {
  list(): Promise<Skill[]>
}

export interface CompactionReport {
  foldedMessages: number
  foldedTokens: number
  summary: string
}

export interface CompactionCapability {
  compact(): Promise<CompactionReport>
}

export interface CommandContext {
  projectPath: string
  openPicker?: OpenPicker
  sessions?: SessionsCapability
  exit?: ExitCapability
  navigation?: NavigationCapability
  models?: ModelsCapability
  providers?: ProvidersCapability
  skills?: SkillContext
  key?: KeyCapability
  compaction?: CompactionCapability
  onSkillActivate?: (content: string) => void
}

export interface Session {
  id: string
  name?: string
  /**
   * Canonical `provider/model` id. Stored in qualified form only from
   * `QUALIFIED_MODEL_FORMAT_VERSION` onward; see model-id.ts.
   */
  model: string
  /**
   * On-disk format version. A session without it predates provider
   * qualification, which is the only thing that makes its stored model id
   * unambiguous. See `QUALIFIED_MODEL_FORMAT_VERSION`.
   */
  version?: number
  messages: Message[]
  createdAt: string
  updatedAt: string
  totalTokens: number
  totalCost: number
  mode?: ModeId
  lastCompaction?: {
    before: Message[]
    summary: string
    at: string
  }
}
