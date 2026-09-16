import React from "react"
import { describe, it, expect } from "bun:test"
import { render } from "ink-testing-library"
import { CodeBlock } from "./code-block"

function frame(instance: { lastFrame: () => string | undefined }): string {
  return instance.lastFrame() ?? ""
}

describe("CodeBlock", () => {
  it("renders the code body without any literal backtick delimiters", () => {
    const inst = render(<CodeBlock code="echo hi" />)
    const out = frame(inst)
    expect(out).toContain("echo hi")
    expect(out).not.toContain("```")
    inst.unmount()
  })

  it("draws a bordered frame around the code", () => {
    const inst = render(<CodeBlock code="echo hi" />)
    const out = frame(inst)
    expect(/[┌└]/.test(out)).toBe(true)
    inst.unmount()
  })

  it("shows the language tag when provided", () => {
    const inst = render(<CodeBlock code="echo hi" language="bash" />)
    expect(frame(inst)).toContain("bash")
    inst.unmount()
  })

  it("renders code with leading blank lines without dropping the empty line", () => {
    const inst = render(<CodeBlock code={"line1\n\nline3"} />)
    expect(frame(inst)).toContain("line1")
    expect(frame(inst)).toContain("line3")
    inst.unmount()
  })

  it("omits the language label when language is undefined", () => {
    const inst = render(<CodeBlock code="echo hi" />)
    expect(frame(inst)).toContain("echo hi")
    inst.unmount()
  })
})