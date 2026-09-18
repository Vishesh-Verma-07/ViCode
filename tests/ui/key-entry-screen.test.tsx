import React from "react"
import { describe, it, expect, afterEach } from "bun:test"
import { render } from "ink-testing-library"
import { KeyEntryScreen } from "@/ui/key-entry-screen"

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

  it("renders the required title when requireKey is set", () => {
    const instance = render(<KeyEntryScreen requireKey onSubmit={() => {}} />)
    const frame = instance.lastFrame() ?? ""
    expect(frame).toContain("OpenRouter API key required")
    expect(frame).toContain("Get a key at https://openrouter.ai/keys")
    instance.unmount()
  })

  it("renders the plain title and Save hint in settings mode", () => {
    const instance = render(<KeyEntryScreen onSubmit={() => {}} />)
    const frame = instance.lastFrame() ?? ""
    expect(frame).toContain("OpenRouter API key")
    expect(frame).not.toContain("required")
    expect(frame).toContain("Esc Cancel")
    instance.unmount()
  })

  it("submits the typed key on Enter", async () => {
    const submitted: string[] = []
    const instance = render(
      <KeyEntryScreen
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
        requireKey
        onSubmit={(key) => {
          submitted.push(key)
        }}
      />,
    )
    await sendKeys(instance, ["\r"])
    const frame = instance.lastFrame() ?? ""
    expect(frame).toContain("Enter your OpenRouter API key to continue")
    await sendKeys(instance, ["\r"])
    expect(submitted).toEqual([])
    instance.unmount()
  })

  it("warns on the first Enter with a non-prefixed key and submits on the second", async () => {
    const submitted: string[] = []
    const instance = render(
      <KeyEntryScreen
        onSubmit={(key) => {
          submitted.push(key)
        }}
      />,
    )
    await sendKeys(instance, ["b", "a", "d", "k", "e", "y", "\r"])
    const frame = instance.lastFrame() ?? ""
    expect(frame).toContain("expected sk-or-v1-...")
    expect(submitted).toEqual([])

    await sendKeys(instance, ["\r"])
    expect(submitted).toEqual(["badkey"])
    instance.unmount()
  })

  it("does not warn again when typing a prefixed key after a failed save attempt", async () => {
    const submitted: string[] = []
    const instance = render(
      <KeyEntryScreen
        onSubmit={(key) => {
          submitted.push(key)
        }}
      />,
    )
    await sendKeys(instance, ["b", "a", "d", "\r"])
    expect(submitted).toEqual([])

    await sendKeys(instance, ["s", "k", "-", "o", "r", "-", "v", "1", "-", "o", "k", "\r"])
    expect(submitted).toEqual(["sk-or-v1-ok"])
    instance.unmount()
  })

  it("shows a hint instead of cancelling on Esc when requireKey is set", async () => {
    let cancelled = false
    const instance = render(
      <KeyEntryScreen
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
    expect(frame).toContain("An API key is required to chat")
    instance.unmount()
  })

  it("cancels on Esc in settings mode", async () => {
    let cancelled = false
    const instance = render(
      <KeyEntryScreen
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
    const instance = render(<KeyEntryScreen requireKey onSubmit={() => {}} />)
    await sendKeys(instance, ["\u0003"])
    expect(exitCalled).toBe(true)
    instance.unmount()
  })

  it("only shows the inverse cursor block on the entered value", async () => {
    const instance = render(<KeyEntryScreen requireKey onSubmit={() => {}} />)
    await sendKeys(instance, ["s", "k"])
    const frame = instance.lastFrame() ?? ""
    expect(frame).toContain("sk")
    expect(frame).not.toContain("sk-or-v1-...")
    instance.unmount()
  })
})