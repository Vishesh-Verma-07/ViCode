import { DIFF_START_MARKER, DIFF_END_MARKER } from "../core/constants"

export function extractDiff(result: string): { message: string; diff: string | null } {
  const startIdx = result.indexOf(DIFF_START_MARKER)
  const endIdx = result.indexOf(DIFF_END_MARKER)
  if (startIdx === -1 || endIdx === -1) {
    return { message: result, diff: null }
  }
  const message = result.slice(0, startIdx).trimEnd()
  const diff = result.slice(startIdx + DIFF_START_MARKER.length, endIdx).replace(/^\n/, "")
  return { message, diff }
}
