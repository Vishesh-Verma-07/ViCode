import { z } from "zod"
import type { ToolDefinition, ToolContext } from "../core/types"

const MAX_OUTPUT_BYTES = 1024 * 1024

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export const bashTool: ToolDefinition = {
  name: "bash",
  description: "Execute a shell command and return its output. Use for running tests, builds, git commands, and other system operations.",
  parameters: z.object({
    command: z.string().describe("Shell command to execute"),
    cwd: z.string().optional().describe("Working directory (defaults to project root)"),
    timeout: z.number().optional().describe("Timeout in seconds (default 30)"),
  }),
  dangerous: true,
  execute: async (args, context) => {
    const command = args.command as string
    const cwd = (args.cwd as string) || context.projectPath
    const timeoutMs = ((args.timeout as number) || 30) * 1000

    const proc = Bun.spawn(["bash", "-c", command], {
      cwd,
      stdout: "pipe",
      stderr: "pipe",
    })

    let timedOut = false

    const readAll = async (): Promise<{ stdout: string; stderr: string; exitCode: number }> => {
      const stdoutBuf: number[] = []
      const stderrBuf: number[] = []

      const readStream = async (
        stream: ReadableStream<Uint8Array>,
        buf: number[],
      ) => {
        const reader = stream.getReader()
        try {
          while (true) {
            const { done, value } = await reader.read()
            if (done) break
            for (const byte of value) {
              if (buf.length < MAX_OUTPUT_BYTES) buf.push(byte)
            }
          }
        } catch {
          reader.cancel().catch(() => {})
        }
      }

      await Promise.all([
        readStream(proc.stdout, stdoutBuf),
        readStream(proc.stderr, stderrBuf),
        proc.exited,
      ])

      return {
        stdout: new TextDecoder().decode(new Uint8Array(stdoutBuf)),
        stderr: new TextDecoder().decode(new Uint8Array(stderrBuf)),
        exitCode: proc.exitCode ?? 0,
      }
    }

    const timeout = delay(timeoutMs).then(() => {
      timedOut = true
      try { proc.kill("SIGKILL") } catch {}
    })

    try {
      const result = await Promise.race([readAll(), timeout.then(() => null)])

      if (timedOut || result === null) {
        return `Error: command timed out after ${timeoutMs / 1000}s`
      }

      const { stdout, stderr, exitCode } = result

      const parts: string[] = []
      if (stdout) parts.push(stdout)
      if (stderr) parts.push(stderr)

      if (parts.length === 0) {
        if (exitCode !== 0) {
          return `Error: command exited with status ${exitCode}`
        }
        return "(no output)"
      }

      if (exitCode !== 0) {
        return `Error (exit ${exitCode}):\n${parts.join("\n")}`
      }

      return parts.join("\n")
    } catch (error) {
      try { proc.kill("SIGKILL") } catch {}
      return `Error: ${error instanceof Error ? error.message : String(error)}`
    }
  },
}
