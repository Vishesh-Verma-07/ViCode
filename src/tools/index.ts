import type { ToolDefinition } from "../core/types"
import { readFileTool } from "./read-file"
import { listFilesTool } from "./list-files"
import { searchTool } from "./search"

export const readOnlyTools: ToolDefinition[] = [readFileTool, listFilesTool, searchTool]
