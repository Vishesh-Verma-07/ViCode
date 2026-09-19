import { PassThrough } from "node:stream"

const CTRL_DELETE_SEQUENCE = Buffer.from([0x1b, 0x5b, 0x33, 0x3b, 0x35, 0x7e])
const BS_BYTE = 0x08

export function rewriteBackspaceEncoding(chunk: Buffer | string): Buffer | string {
  const bytes = typeof chunk === "string" ? Buffer.from(chunk, "utf8") : chunk
  if (bytes.length === 1 && bytes[0] === BS_BYTE) return CTRL_DELETE_SEQUENCE
  return chunk
}

export function createBackspaceRewritingStdin(stdin: NodeJS.ReadStream): NodeJS.ReadStream {
  const proxy = new PassThrough()
  const decorated = proxy as PassThrough & {
    isTTY?: boolean
    setRawMode?: (flag: boolean) => void
    ref?: () => void
    unref?: () => void
  }
  decorated.isTTY = stdin.isTTY
  decorated.setRawMode = (flag) => {
    ;(stdin as { setRawMode?: (mode: boolean) => void }).setRawMode?.(flag)
  }
  decorated.ref = () => {
    ;(stdin as { ref?: () => void }).ref?.()
  }
  decorated.unref = () => {
    ;(stdin as { unref?: () => void }).unref?.()
  }
  stdin.on("data", (chunk: Buffer) => {
    proxy.write(rewriteBackspaceEncoding(chunk))
  })
  return decorated as unknown as NodeJS.ReadStream
}