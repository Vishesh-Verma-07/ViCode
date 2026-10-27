import { describe, it, expect } from "bun:test"
import { clipboardCommands, copyToClipboard, osc52Sequence } from "@/core/clipboard"

describe("clipboardCommands", () => {
  it("uses PowerShell, then clip, on Windows", () => {
    const commands = clipboardCommands("win32").map((candidate) => candidate.command)
    expect(commands).toEqual(["powershell.exe", "clip"])
  })

  it("uses pbcopy on macOS", () => {
    expect(clipboardCommands("darwin").map((candidate) => candidate.command)).toEqual(["pbcopy"])
  })

  it("tries the Wayland and X11 tools on Linux", () => {
    expect(clipboardCommands("linux").map((candidate) => candidate.command)).toEqual([
      "wl-copy",
      "xclip",
      "xsel",
    ])
  })
})

describe("osc52Sequence", () => {
  it("base64-encodes the text inside the OSC 52 clipboard sequence", () => {
    expect(osc52Sequence("hi")).toBe("\u001B]52;c;aGk=\u0007")
  })

  it("round-trips UTF-8 text", () => {
    const text = "line one\nline two — ✓"
    const encoded = osc52Sequence(text).slice("\u001B]52;c;".length, -1)
    expect(Buffer.from(encoded, "base64").toString("utf8")).toBe(text)
  })
})

describe("copyToClipboard", () => {
  it("hands the text to the first command that succeeds", async () => {
    const calls: Array<{ command: string; args: string[]; input: string }> = []
    const result = await copyToClipboard("copy me", {
      platform: "darwin",
      run: async (command, args, input) => {
        calls.push({ command, args, input })
        return command === "pbcopy"
      },
    })

    expect(result).toEqual({ kind: "copied", via: "command", command: "pbcopy" })
    expect(calls).toHaveLength(1)
    expect(calls[0]?.input).toBe("copy me")
  })

  it("falls back to OSC 52 when no clipboard command works", async () => {
    let written = ""
    const result = await copyToClipboard("remote text", {
      platform: "linux",
      run: async () => false,
      write: (data) => {
        written += data
      },
    })

    expect(result).toEqual({ kind: "copied", via: "terminal" })
    expect(written).toBe(osc52Sequence("remote text"))
  })

  it("reports failure when there is no command and no terminal to write to", async () => {
    const result = await copyToClipboard("nowhere", {
      platform: "linux",
      run: async () => false,
      isTty: false,
    })

    expect(result).toEqual({ kind: "failed", reason: "no clipboard tool available" })
  })

  it("does not touch the clipboard for empty text", async () => {
    let ran = false
    const result = await copyToClipboard("", {
      run: async () => {
        ran = true
        return true
      },
    })

    expect(result.kind).toBe("failed")
    expect(ran).toBe(false)
  })
})
