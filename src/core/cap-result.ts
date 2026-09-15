export const MAX_TOOL_RESULT_BYTES = 64 * 1024
export const TRUNCATION_MARKER_BYTES = 96
export const VICODE_TRUNCATION_SENTINEL = "\u0000VICODE_TRUNCATION_SENTINEL\u0000"

const encoderGlobal = new TextEncoder()
const decoderGlobal = new TextDecoder("utf-8", { fatal: true })

function isCont(b: number): boolean {
  return (b & 0b1100_0000) === 0b1000_0000
}

function headEndAt(bytes: Uint8Array, budget: number): number {
  let i = Math.min(budget, bytes.length)
  while (i > 0 && isCont(bytes[i - 1]!)) i--
  return i
}

function tailStartAt(bytes: Uint8Array, budget: number): number {
  let i = Math.max(0, bytes.length - budget)
  while (i < bytes.length && isCont(bytes[i]!)) i++
  return i
}

function retMarker(omitted: number, cap: number): string {
  const s = VICODE_TRUNCATION_SENTINEL
  return (
    "\n\n" + s + "\n" + omitted + " bytes omitted; tool result capped at " + cap +
    " bytes.\nRe-query narrowly (bounded read range, narrower search, targeted command) before relying on exact text such as oldText.\n" + s + "\n"
  )
}

function doCap(bytes: Uint8Array, cap: number): string {
  if (bytes.length <= cap) return decoderGlobal.decode(bytes)
  const STEP = 8
  let budget = cap - TRUNCATION_MARKER_BYTES
  for (let pass = 0; pass < STEP; pass++) {
    const contentBudget = Math.max(0, budget)
    const half = Math.floor(contentBudget / 2)
    const hEnd = headEndAt(bytes, half)
    const tStart = tailStartAt(bytes, contentBudget - half)
    const omitted = bytes.length - (hEnd + (bytes.length - tStart))
    const marker = retMarker(omitted, cap)
    const markerBytes = encoderGlobal.encode(marker).length
    const total = hEnd + (bytes.length - tStart) + markerBytes
    if (total <= cap) {
      return (
        new TextDecoder().decode(bytes.subarray(0, hEnd)) +
        marker +
        new TextDecoder().decode(bytes.subarray(tStart))
      )
    }
    budget = budget - (total - cap) - 1
  }
  const end = headEndAt(bytes, Math.max(0, cap - TRUNCATION_MARKER_BYTES))
  const o2 = bytes.length - end
  return new TextDecoder().decode(bytes.subarray(0, end)) + retMarker(o2, cap)
}

export function capResult(result: string, cap: number = MAX_TOOL_RESULT_BYTES): string {
  return doCap(encoderGlobal.encode(result), cap)
}
