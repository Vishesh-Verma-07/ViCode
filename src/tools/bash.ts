import { spawn } from "node:child_process"
import { z } from "zod"
import type { ToolDefinition, ToolContext } from "../core/types"
import { bashRequiresApproval } from "../core/bash-allowlist"

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
  requiresApproval: bashRequiresApproval,
  execute: async (args, context) => {
    const command = args.command as string
    const cwd = (args.cwd as string) || context.projectPath
    const timeoutMs = ((args.timeout as number) || 30) * 1000

    const proc = spawn("bash", ["-c", command], { cwd })

    let timedOut = false

    const stdoutBuf: number[] = []
    const stderrBuf: number[] = []

    const collect = (stream: NodeJS.ReadableStream, buf: number[]) => {
      stream.on("data", (chunk: Buffer) => {
        for (const byte of chunk) {
          if (buf.length < MAX_OUTPUT_BYTES) buf.push(byte)
        }
      })
    }
    collect(proc.stdout, stdoutBuf)
    collect(proc.stderr, stderrBuf)

    const decode = (buf: number[]): string =>
      new TextDecoder().decode(new Uint8Array(buf))

    const exited = new Promise<number | null>((resolve) => {
      proc.on("close", (code) => resolve(code))
      proc.on("error", () => resolve(null))
    })

    const timeout = delay(timeoutMs).then(() => {
      timedOut = true
      try { proc.kill("SIGKILL") } catch {}
    })

    try {
      const result = await Promise.race([
        exited.then(async (exitCode) => ({
          stdout: decode(stdoutBuf),
          stderr: decode(stderrBuf),
          exitCode: exitCode ?? 0,
        })),
        timeout.then(() => null),
      ])

      try { proc.kill("SIGKILL") } catch {}

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
