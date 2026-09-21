import React, { useState } from "react"
import { describe, expect, it, afterEach } from "bun:test"
import { render } from "ink-testing-library"
import { ChatInput } from "@/ui/chat-input"

const LEFT = "\u001B[D"
const RIGHT = "\u001B[C"
const HOME = "\u001B[H"
const END = "\u001B[F"
const DELETE = "\u001B[3~"
const BACKSPACE = "\u007F"
const CTRL_W = "\u0017"

async function sendKeys(instance: { stdin: { write: (s: string) => void } }, keys: string[]): Promise<void> {
  for (const key of keys) {
    instance.stdin.write(key)
    await new Promise((resolve) => setTimeout(resolve, 15))
  }
}

function Harness({ onValue }: { onValue: (value: string) => void }) {
  const [value, setValue] = useState("")
  return (
    <ChatInput
      value={value}
      placeholder="Type..."
      onChange={(next) => {
        setValue(next)
        onValue(next)
      }}
    />
  )
}

describe("ChatInput cursor-aware editing", () => {
  const originalExit = process.exit

  afterEach(() => {
    process.exit = originalExit
  })

  it("appends typed text normally at the end", async () => {
    const changes: string[] = []
    const instance = render(<Harness onValue={(v) => changes.push(v)} />)
    await sendKeys(instance, ["h", "e", "y"])
    expect(changes.at(-1)).toBe("hey")
    expect((instance.lastFrame() ?? "").replace(/\u001b\[[0-9;]*m/g, "")).toContain("hey")
    instance.unmount()
  })

  it("inserts at the cursor after moving left with arrows", async () => {
    const changes: string[] = []
    const instance = render(<Harness onValue={(v) => changes.push(v)} />)
    await sendKeys(instance, ["h", "e", "l", "l", "o"])
    await sendKeys(instance, [LEFT, LEFT, LEFT])
    await sendKeys(instance, ["X"])
    expect(changes.at(-1)).toBe("heXllo")
    instance.unmount()
  })

  it("backspace removes before the cursor and delete removes under it", async () => {
    const changes: string[] = []
    const instance = render(<Harness onValue={(v) => changes.push(v)} />)
    await sendKeys(instance, ["h", "e", "l", "l", "o"])
    await sendKeys(instance, [LEFT, LEFT, LEFT]) // cursor between "he"|"llo"
    await sendKeys(instance, ["X"]) // "heXllo"
    await sendKeys(instance, [BACKSPACE]) // "hello", cursor between "he"|"llo"
    await sendKeys(instance, [RIGHT]) // cursor after "hel"
    await sendKeys(instance, [DELETE]) // remove the "l" under the cursor
    expect(changes.at(-1)).toBe("helo")
    instance.unmount()
  })

  it("home and end jump to the start and end", async () => {
    const changes: string[] = []
    const instance = render(<Harness onValue={(v) => changes.push(v)} />)
    await sendKeys(instance, ["a", "b", "c"])
    await sendKeys(instance, [HOME])
    await sendKeys(instance, ["Z"]) // "Zabc"
    await sendKeys(instance, [END])
    await sendKeys(instance, ["!"]) // "Zabc!"
    expect(changes.at(-1)).toBe("Zabc!")
    instance.unmount()
  })

  it("ctrl+w deletes the word before the cursor", async () => {
    const changes: string[] = []
    const instance = render(<Harness onValue={(v) => changes.push(v)} />)
    await sendKeys(instance, ["h", "e", "l", "l", "o"])
    await sendKeys(instance, [LEFT, LEFT, LEFT]) // cursor between "he"|"llo"
    await sendKeys(instance, [CTRL_W])
    expect(changes.at(-1)).toBe("llo")
    instance.unmount()
  })
})