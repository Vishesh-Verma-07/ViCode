import { spawn } from "child_process"

/** One way to hand text to the operating system's clipboard. */
export interface ClipboardCommand {
  command: string
  args: string[]
}

export type ClipboardResult =
  | { kind: "copied"; via: "command"; command: string }
  | { kind: "copied"; via: "terminal" }
  | { kind: "failed"; reason: string }

export interface CopyTextOptions {
  /** Platform to choose commands for; injected so the choice is testable. */
  platform?: NodeJS.Platform
  /** Runs one command with the text on stdin and reports whether it worked. */
  run?: (command: string, args: string[], input: string) => Promise<boolean>
  /** Writes the OSC 52 fallback; defaults to stdout. */
  write?: (data: string) => void
  /** Whether the terminal can carry OSC 52. Defaults to stdout being a TTY. */
  isTty?: boolean
}

/**
 * The commands to try, in order, for a platform. A missing command is not an
 * error — the next one is tried — so a Linux desktop with both Wayland and X11
 * tools installed still works whichever display the session is on.
 */
export function clipboardCommands(platform: NodeJS.Platform = process.platform): ClipboardCommand[] {
  switch (platform) {
    case "win32":
      return [
        {
          command: "powershell.exe",
          args: [
            "-NoProfile",
            "-NonInteractive",
            "-Command",
            "[Console]::InputEncoding = [System.Text.Encoding]::UTF8; $text = [Console]::In.ReadToEnd(); Set-Clipboard -Value $text",
          ],
        },
        { command: "clip", args: [] },
      ]
    case "darwin":
      return [{ command: "pbcopy", args: [] }]
    default:
      return [
        { command: "wl-copy", args: [] },
        { command: "xclip", args: ["-selection", "clipboard"] },
        { command: "xsel", args: ["--clipboard", "--input"] },
      ]
  }
}

/**
 * OSC 52 asks the terminal itself to put text on the clipboard. It is the
 * fallback for a machine whose clipboard tools are absent — an SSH session, or
 * a container — and works wherever the terminal supports the sequence.
 */
export function osc52Sequence(text: string): string {
  return `\u001B]52;c;${Buffer.from(text, "utf8").toString("base64")}\u0007`
}

function runClipboardCommand(command: string, args: string[], input: string): Promise<boolean> {
  return new Promise((resolve) => {
    let child: ReturnType<typeof spawn>
    try {
      child = spawn(command, args, {
        stdio: ["pipe", "ignore", "ignore"],
        windowsHide: true,
      })
    } catch {
      resolve(false)
      return
    }

    let settled = false
    const finish = (ok: boolean) => {
      if (settled) return
      settled = true
      resolve(ok)
    }

    child.on("error", () => finish(false))
    child.on("close", (code) => finish(code === 0))
    // The command may exit before reading stdin (a missing display, for one).
    child.stdin?.on("error", () => finish(false))
    child.stdin?.end(input)
  })
}

/**
 * Puts text on the system clipboard. A native command is tried first because
 * it is the only route that works when output is not a terminal; OSC 52 is the
 * last resort for a remote or minimal environment.
 */
export async function copyToClipboard(
  text: string,
  options: CopyTextOptions = {},
): Promise<ClipboardResult> {
  if (!text) return { kind: "failed", reason: "nothing to copy" }

  const platform = options.platform ?? process.platform
  const run = options.run ?? runClipboardCommand
  for (const candidate of clipboardCommands(platform)) {
    if (await run(candidate.command, candidate.args, text)) {
      return { kind: "copied", via: "command", command: candidate.command }
    }
  }

  const isTty = options.isTty ?? Boolean(process.stdout.isTTY)
  if (!options.write && !isTty) {
    return { kind: "failed", reason: "no clipboard tool available" }
  }
  const write = options.write ?? ((data: string) => process.stdout.write(data))
  write(osc52Sequence(text))
  return { kind: "copied", via: "terminal" }
}
