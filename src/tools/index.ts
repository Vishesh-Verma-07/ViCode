import type { ToolDefinition } from "../core/types"
import { readFileTool } from "./read-file"
import { listFilesTool } from "./list-files"
import { searchTool } from "./search"
import { writeFileTool } from "./write-file"
import { editFileTool } from "./edit-file"
import { bashTool } from "./bash"

export const readOnlyTools: ToolDefinition[] = [readFileTool, listFilesTool, searchTool]

export const writeTools: ToolDefinition[] = [writeFileTool, editFileTool, bashTool]

export const allTools: ToolDefinition[] = [...readOnlyTools, ...writeTools]
