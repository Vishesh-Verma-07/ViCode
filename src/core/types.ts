import type { z } from "zod"
import type { ModelListing } from "./provider"

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

export type Content = TextContent | ToolCallContent | ToolResultContent

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
}

export interface ToolContext {
  projectPath: string
}

export interface Command {
  name: string
  description: string
  execute: (args: string[], context: CommandContext) => Promise<string>
}

export interface PickerItem {
  label: string
  metadata?: string
}

export interface PickerRequest {
  title: string
  items: PickerItem[]
}

export type OpenPicker = (request: PickerRequest) => Promise<number | null>

export interface SessionsCapability {
  dir: string
  getActiveSession(): Session | null
  switchTo(session: Session): void
  startFresh(): void
}

export interface ExitCapability {
  requestExit(): Promise<void>
}

export interface ModelsCapability {
  list(): Promise<ModelListing[]>
  getCurrentModelId(): string
  switchTo(modelId: string): void
}

export interface CommandContext {
  projectPath: string
  openPicker?: OpenPicker
  sessions?: SessionsCapability
  exit?: ExitCapability
  models?: ModelsCapability
}

export interface Session {
  id: string
  projectPath: string
  model: string
  messages: Message[]
  createdAt: string
  updatedAt: string
  totalTokens: number
  totalCost: number
}
