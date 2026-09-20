import { resolveInsideProject } from "./sensitive-files"
import type { ToolContext } from "./types"

export const DEFAULT_ALLOWLIST = ["node", "ls", "echo", "cat", "find"]

export function bashRequiresApproval(
  args: Record<string, unknown>,
  context: ToolContext,
): boolean {
  const command = typeof args.command === "string" ? args.command : ""
  if (!command.trim()) return true

  const declaredCwd = typeof args.cwd === "string" ? args.cwd : ""
  const relCwd = resolveInsideProject(declaredCwd, context.projectPath)
  return relCwd === null
}