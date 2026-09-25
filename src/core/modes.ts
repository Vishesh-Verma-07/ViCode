import { join, resolve, sep } from "path"
import type { ToolDefinition, ToolContext } from "./types"
import { readOnlyTools, writeTools } from "../tools/index"

export type ModeId = "build" | "discuss" | "plan"

export type ModeColor = "modeBuild" | "modeDiscuss" | "modePlan"

export type ModeToolGate = (args: Record<string, unknown>, context: Pick<ToolContext, "projectPath">) => boolean

export interface ModeDefinition {
  id: ModeId
  name: string
  color: ModeColor
  toolSet: ToolDefinition[]
  promptLayer: string
  toolGate?: Partial<Record<string, ModeToolGate>>
}

const IMPLEMENT_PROMPT_LAYER = `You are operating in build mode: get the work done. Work from the spec or tickets in front of you. Prefer test-first implementation at agreed seams. Run targeted tests and typechecking regularly, and the full test suite once at the end. Review your own diff before finishing. Commit when green.`

const DISCUSS_PROMPT_LAYER = `You are operating in discuss mode, adapted from grill-with-docs. Run a relentless, one-question-at-a-time interview to sharpen the design. Sharpen terms and push back on contradictions between the code and what is said. Capture crystallised decisions into CONTEXT.md, GLOSSARY.md, and docs/adr/. Writes in discuss mode are confined to this docs boundary; any other write or edit is denied by mode. End each turn with exactly one question unless the user indicates they are done.`

const PLAN_PROMPT_LAYER = `You are operating in plan mode: analysis only. You may read, list, and search the project and ask the user questions. You must never modify files or run shell commands. End each analysis with a concrete written plan.`

export function isDocsBoundaryPath(declared: string, projectPath: string): boolean {
  if (declared.trim().length === 0) return false
  const root = resolve(projectPath)
  const abs = resolve(root, declared).toLowerCase()
  if (abs === join(root, "CONTEXT.md").toLowerCase()) return true
  if (abs === join(root, "GLOSSARY.md").toLowerCase()) return true
  const adrDir = join(root, "docs", "adr").toLowerCase()
  return abs !== adrDir && abs.startsWith(adrDir + sep)
}

const discussWriteTools = writeTools.filter((t) => t.name !== "bash")

const docsBoundaryGate: ModeToolGate = (args, context) =>
  typeof args.path === "string" && isDocsBoundaryPath(args.path, context.projectPath)

export const MODES: readonly ModeDefinition[] = [
  {
    id: "build",
    name: "Build",
    color: "modeBuild",
    toolSet: [...readOnlyTools, ...writeTools],
    promptLayer: IMPLEMENT_PROMPT_LAYER,
  },
  {
    id: "discuss",
    name: "Discuss",
    color: "modeDiscuss",
    toolSet: [...readOnlyTools, ...discussWriteTools],
    promptLayer: DISCUSS_PROMPT_LAYER,
    toolGate: {
      write_file: docsBoundaryGate,
      edit_file: docsBoundaryGate,
    },
  },
  {
    id: "plan",
    name: "Plan",
    color: "modePlan",
    toolSet: readOnlyTools,
    promptLayer: PLAN_PROMPT_LAYER,
  },
]

export const DEFAULT_MODE: ModeId = MODES[0]!.id

export function isModeId(value: unknown): value is ModeId {
  return typeof value === "string" && MODES.some((m) => m.id === value)
}

export function cycleMode(mode: ModeId): ModeId {
  const index = MODES.findIndex((m) => m.id === mode)
  return MODES[(index + 1) % MODES.length]!.id
}

export function findMode(modeId: ModeId): ModeDefinition | undefined {
  return MODES.find((m) => m.id === modeId)
}

export function resolveModeTools(modeId: ModeId): ToolDefinition[] {
  const definition = findMode(modeId)
  return definition ? definition.toolSet : []
}

export function selectModeTools(catalog: ToolDefinition[], modeId: ModeId): ToolDefinition[] {
  if (modeId === DEFAULT_MODE) return catalog
  const allowed = new Set(resolveModeTools(modeId).map((t) => t.name))
  return catalog.filter((t) => allowed.has(t.name))
}