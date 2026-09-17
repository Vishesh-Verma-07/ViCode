import React from "react"
import { describe, it, expect } from "bun:test"
import { render } from "ink-testing-library"
import chalk from "../../node_modules/ink/node_modules/chalk/source/index.js"
import { InlineChip, InlineCodeText } from "@/ui/inline-chip"
import type { CodeSegment } from "@/core/code-tokenizer"

chalk.level = 3

function frame(instance: { lastFrame: () => string | undefined }): string {
  return instance.lastFrame() ?? ""
}

describe("InlineChip", () => {
  it("renders the code text padded on both sides as a chip", () => {
    const inst = render(<InlineChip text="bun test" />)
    const out = frame(inst)
    expect(out).toContain("bun test")
    inst.unmount()
  })

  it("renders on a dark background without a border", () => {
    const inst = render(<InlineChip text="cmd" />)
    const out = frame(inst)
    expect(out).toMatch(/48;2;42;42;42/)
    expect(out).not.toMatch(/[┌└├┤┐┘┴┬─│]/)
    inst.unmount()
  })
})

describe("InlineCodeText", () => {
  it("renders inline-code spans as chips instead of literal backticks", () => {
    const lines: CodeSegment[][] = [
      [
        { kind: "prose", text: "Run " },
        { kind: "inline-code", text: "bun test" },
        { kind: "prose", text: " to verify." },
      ],
    ]
    const inst = render(<InlineCodeText lines={lines} />)
    const out = frame(inst)
    expect(out).toContain("Run")
    expect(out).toContain("bun test")
    expect(out).toContain("to verify")
    expect(out).not.toContain("`")
    inst.unmount()
  })

  it("renders multiple chips within one prose run", () => {
    const lines: CodeSegment[][] = [
      [
        { kind: "prose", text: "use " },
        { kind: "inline-code", text: "a" },
        { kind: "prose", text: " then " },
        { kind: "inline-code", text: "b" },
        { kind: "prose", text: " now" },
      ],
    ]
    const inst = render(<InlineCodeText lines={lines} />)
    const out = frame(inst)
    expect(out).toContain("use")
    expect(out).toContain(" now")
    expect(out).not.toContain("`")
    inst.unmount()
  })

  it("preserves line breaks across prose runs", () => {
    const lines: CodeSegment[][] = [
      [{ kind: "prose", text: "first line" }],
      [
        { kind: "prose", text: "second line " },
        { kind: "inline-code", text: "cmd" },
      ],
    ]
    const inst = render(<InlineCodeText lines={lines} />)
    const out = frame(inst)
    expect(out).toContain("first line")
    expect(out).toContain("second line")
    expect(out).toContain("cmd")
    inst.unmount()
  })

  it("renders the bold colored prefix ahead of the first line", () => {
    const lines: CodeSegment[][] = [[{ kind: "prose", text: "hello" }]]
    const inst = render(<InlineCodeText lines={lines} prefix="vicode: " prefixColor="green" />)
    const out = frame(inst)
    expect(out).toContain("vicode:")
    expect(out).toContain("hello")
    inst.unmount()
  })
})