import React from "react"
import { describe, it, expect } from "bun:test"
import { render } from "ink-testing-library"
import { Picker } from "./picker"
import type { PickerItem } from "../core/types"

const items: PickerItem[] = [
  { label: "sess_a", metadata: "1/1/2025, 10:00:00 AM | 2 messages | model-a" },
  { label: "sess_b", metadata: "2/1/2025, 11:00:00 AM | 5 messages | model-b" },
]

async function sendKeys(instance: { stdin: { write: (s: string) => void } }, keys: string[]): Promise<void> {
  for (const key of keys) {
    instance.stdin.write(key)
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
}

describe("Picker", () => {
  it("renders the title, item labels and metadata lines", () => {
    const instance = render(
      <Picker title="Switch to session" items={items} onSelect={() => {}} onCancel={() => {}} />,
    )
    const frame = instance.lastFrame() ?? ""
    expect(frame).toContain("Switch to session")
    expect(frame).toContain("sess_a")
    expect(frame).toContain("sess_b")
    expect(frame).toContain("2 messages | model-a")
    expect(frame).toContain("5 messages | model-b")
    instance.unmount()
  })

  it("highlights the first item initially", () => {
    const instance = render(
      <Picker title="Pick" items={items} onSelect={() => {}} onCancel={() => {}} />,
    )
    const frame = instance.lastFrame() ?? ""
    expect(frame).toContain("> sess_a")
    expect(frame).not.toContain("> sess_b")
    instance.unmount()
  })

  it("moves the highlight down with the down arrow", async () => {
    const instance = render(
      <Picker title="Pick" items={items} onSelect={() => {}} onCancel={() => {}} />,
    )
    await sendKeys(instance, ["\u001B[B"])
    const frame = instance.lastFrame() ?? ""
    expect(frame).toContain("> sess_b")
    expect(frame).not.toContain("> sess_a")
    instance.unmount()
  })

  it("does not move the highlight above the first item", async () => {
    const instance = render(
      <Picker title="Pick" items={items} onSelect={() => {}} onCancel={() => {}} />,
    )
    await sendKeys(instance, ["\u001B[A", "\u001B[A"])
    const frame = instance.lastFrame() ?? ""
    expect(frame).toContain("> sess_a")
    instance.unmount()
  })

  it("selects the highlighted item on Enter", async () => {
    const selected: number[] = []
    const instance = render(
      <Picker title="Pick" items={items} onSelect={(i) => selected.push(i)} onCancel={() => {}} />,
    )
    await sendKeys(instance, ["\u001B[B", "\r"])
    expect(selected).toEqual([1])
    instance.unmount()
  })

  it("cancels on Escape without selecting", async () => {
    let cancelled = false
    let selected = false
    const instance = render(
      <Picker
        title="Pick"
        items={items}
        onSelect={() => {
          selected = true
        }}
        onCancel={() => {
          cancelled = true
        }}
      />,
    )
    await sendKeys(instance, ["\u001B[B", "\u001B"])
    expect(cancelled).toBe(true)
    expect(selected).toBe(false)
    instance.unmount()
  })

  it("renders a no-items state and ignores Enter", async () => {
    const selected: number[] = []
    let cancelled = false
    const instance = render(
      <Picker
        title="Pick"
        items={[]}
        onSelect={(i) => selected.push(i)}
        onCancel={() => {
          cancelled = true
        }}
      />,
    )
    const frame = instance.lastFrame() ?? ""
    expect(frame).toContain("No items")
    await sendKeys(instance, ["\r"])
    expect(selected).toEqual([])
    expect(cancelled).toBe(false)
    instance.unmount()
  })
})
