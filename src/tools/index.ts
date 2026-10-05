import type { ToolDefinition } from "../core/types"
import { readFileTool } from "./read-file"
import { listFilesTool } from "./list-files"
import { searchTool } from "./search"
import { webSearchTool } from "./web-search"
import { writeFileTool } from "./write-file"
import { editFileTool } from "./edit-file"
import { bashTool } from "./bash"

/**
 * Read-only in the strict sense: nothing here changes anything on disk.
 *
 * `web_search` qualifies because it only sends a query out; it reads nothing
 * local and writes nothing local. That is also why it is offered in every Mode —
 * a Mode's tool set is a statement about what may be *changed*, and a search
 * changes nothing.
 */
export const readOnlyTools: ToolDefinition[] = [
  readFileTool,
  listFilesTool,
  searchTool,
  webSearchTool,
]

export const writeTools: ToolDefinition[] = [writeFileTool, editFileTool, bashTool]

export const allTools: ToolDefinition[] = [...readOnlyTools, ...writeTools]
