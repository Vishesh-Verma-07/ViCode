import React from "react"
import { describe, it, expect, afterEach } from "bun:test"
import { render } from "ink-testing-library"
import { KeyEntryScreen } from "@/ui/key-entry-screen"
import type { ProviderId } from "@/core/providers"

async function sendKeys(instance: { stdin: { write: (s: string) => void } }, keys: string[]): Promise<void> {
  for (const key of keys) {
    instance.stdin.write(key)
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
}

describe("KeyEntryScreen", () => {
  const originalExit = process.exit

  afterEach(() => {
    process.exit = originalExit
  })

  it("names the Provider it is collecting a key for", () => {
    const instance = render(<KeyEntryScreen provider="anthropic" requireKey onSubmit={() => {}} />)
    const frame = instance.lastFrame() ?? ""
    expect(frame).toContain("Anthropic API key required")
    expect(frame).toContain("https://console.anthropic.com/settings/keys")
    expect(frame).not.toContain("OpenRouter")
    instance.unmount()
  })

  it("shows the gateway's own key URL, not OpenRouter's", () => {
    const instance = render(<KeyEntryScreen provider="opencode" requireKey onSubmit={() => {}} />)
    const frame = instance.lastFrame() ?? ""
    expect(frame).toContain("OpenCode Zen API key required")
    expect(frame).toContain("https://opencode.ai/console")
    instance.unmount()
  })

  it("renders the plain title and Save hint in settings mode", () => {
    const instance = render(<KeyEntryScreen provider="openrouter" onSubmit={() => {}} />)
    const frame = instance.lastFrame() ?? ""
    expect(frame).toContain("OpenRouter API key")
    expect(frame).not.toContain("required")
    expect(frame).toContain("Esc Cancel")
    instance.unmount()
  })

  it("says a required key is needed to chat on that Provider", () => {
    const instance = render(<KeyEntryScreen provider="openai" requireKey onSubmit={() => {}} />)
    const frame = instance.lastFrame() ?? ""
    expect(frame).toContain("chat on this provider")
    instance.unmount()
  })

  it("submits the typed key on Enter", async () => {
    const submitted: string[] = []
    const instance = render(
      <KeyEntryScreen
        provider="openrouter"
        onSubmit={(key) => {
          submitted.push(key)
        }}
      />,
    )
    await sendKeys(instance, ["s", "k", "-", "o", "r", "-", "v", "1", "-", "k", "e", "y", "\r"])
    expect(submitted).toEqual(["sk-or-v1-key"])
    expect(instance.lastFrame() ?? "").not.toContain("OpenRouter API key")
    instance.unmount()
  })

  it("warns instead of submitting when the value is empty", async () => {
    const submitted: string[] = []
    const instance = render(
      <KeyEntryScreen
        provider="anthropic"
        requireKey
        onSubmit={(key) => {
          submitted.push(key)
        }}
      />,
    )
    await sendKeys(instance, ["\r"])
    const frame = instance.lastFrame() ?? ""
    expect(frame).toContain("Enter your Anthropic API key to continue")
    await sendKeys(instance, ["\r"])
    expect(submitted).toEqual([])
    instance.unmount()
  })

  it("accepts a key with no recognisable prefix", async () => {
    // The vendors do not document their key format, so nothing is validated
    // beyond being non-empty.
    const submitted: string[] = []
    const instance = render(
      <KeyEntryScreen
        provider="anthropic"
        onSubmit={(key) => {
          submitted.push(key)
        }}
      />,
    )
    await sendKeys(instance, ["n", "o", "-", "p", "r", "e", "f", "i", "x", "\r"])
    expect(submitted).toEqual(["no-prefix"])
    instance.unmount()
  })

  it("trims surrounding whitespace before submitting", async () => {
    const submitted: string[] = []
    const instance = render(
      <KeyEntryScreen
        provider="openai"
        onSubmit={(key) => {
          submitted.push(key)
        }}
      />,
    )
    await sendKeys(instance, ["s", "k", "-", "x", " ", " ", "\r"])
    expect(submitted).toEqual(["sk-x"])
    instance.unmount()
  })

  it("shows a hint instead of cancelling on Esc when requireKey is set", async () => {
    let cancelled = false
    const instance = render(
      <KeyEntryScreen
        provider="openrouter"
        requireKey
        onSubmit={() => {}}
        onCancel={() => {
          cancelled = true
        }}
      />,
    )
    await sendKeys(instance, ["\u001B"])
    expect(cancelled).toBe(false)
    const frame = instance.lastFrame() ?? ""
    expect(frame).toContain("API key is required to chat")
    instance.unmount()
  })

  it("cancels on Esc in settings mode", async () => {
    let cancelled = false
    const instance = render(
      <KeyEntryScreen
        provider="openrouter"
        onSubmit={() => {}}
        onCancel={() => {
          cancelled = true
        }}
      />,
    )
    await sendKeys(instance, ["\u001B"])
    expect(cancelled).toBe(true)
    instance.unmount()
  })

  it("cancels on Ctrl+C in settings mode", async () => {
    let cancelled = false
    const instance = render(
      <KeyEntryScreen
        provider="openrouter"
        onSubmit={() => {}}
        onCancel={() => {
          cancelled = true
        }}
      />,
    )
    await sendKeys(instance, ["\u0003"])
    expect(cancelled).toBe(true)
    instance.unmount()
  })

  it("exits the process on Ctrl+C when a key is required", async () => {
    let exitCalled = false
    process.exit = ((code?: number) => {
      exitCalled = true
      expect(code).toBe(0)
    }) as unknown as typeof process.exit
    const instance = render(<KeyEntryScreen provider="openrouter" requireKey onSubmit={() => {}} />)
    await sendKeys(instance, ["\u0003"])
    expect(exitCalled).toBe(true)
    instance.unmount()
  })

  it("only shows the inverse cursor block on the entered value", async () => {
    const instance = render(<KeyEntryScreen provider="openrouter" requireKey onSubmit={() => {}} />)
    await sendKeys(instance, ["s", "k"])
    const frame = instance.lastFrame() ?? ""
    expect(frame).toContain("sk")
    expect(frame).not.toContain("paste your key")
    instance.unmount()
  })

  it("shows the existing key so it can be edited in place", () => {
    const instance = render(
      <KeyEntryScreen
        provider="openrouter"
        initialValue="sk-or-v1-existing"
        onSubmit={() => {}}
      />,
    )
    expect(instance.lastFrame() ?? "").toContain("sk-or-v1-existing")
    instance.unmount()
  })
})

describe("KeyEntryScreen across Providers", () => {
  const CASES: Array<[ProviderId, string, string]> = [
    ["openrouter", "OpenRouter", "https://openrouter.ai/keys"],
    ["openai", "OpenAI", "https://platform.openai.com/api-keys"],
    ["anthropic", "Anthropic", "https://console.anthropic.com/settings/keys"],
    ["opencode", "OpenCode Zen", "https://opencode.ai/console"],
    ["opencode-go", "OpenCode Go", "https://opencode.ai/console"],
  ]

  for (const [provider, label, keyUrl] of CASES) {
    it(`labels ${provider} correctly`, () => {
      const instance = render(<KeyEntryScreen provider={provider} requireKey onSubmit={() => {}} />)
      const frame = instance.lastFrame() ?? ""
      expect(frame).toContain(`${label} API key required`)
      expect(frame).toContain(keyUrl)
      instance.unmount()
    })
  }
})