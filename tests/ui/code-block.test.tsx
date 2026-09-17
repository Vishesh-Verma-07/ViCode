import React from "react"
import { describe, it, expect } from "bun:test"
import { render } from "ink-testing-library"
import { renderToString } from "ink"
import { CodeBlock } from "@/ui/code-block"
import { COLORS } from "@/ui/theme"
import { ansiCode } from "@/ui/ansi-test"

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

  it("leads the framed output with the $ Command Line when commandLine is provided", () => {
    const inst = render(<CodeBlock code={"out 1\nout 2"} commandLine="ls -la" />)
    const out = frame(inst)
    expect(out).toContain("$ ls -la")
    expect(out).toContain("out 1")
    expect(out.indexOf("$ ls -la")).toBeLessThan(out.indexOf("out 1"))
    inst.unmount()
  })

  it("omits the $ Command Line when commandLine is undefined", () => {
    const inst = render(<CodeBlock code="out 1" />)
    expect(frame(inst)).toContain("out 1")
    expect(frame(inst)).not.toContain("$ ")
    inst.unmount()
  })

  it("paints the $ Command Line in the primary color within the frame", () => {
    const out = renderToString(<CodeBlock code="out 1" commandLine="ls -la" />, { columns: 40 })
    expect(out).toContain("$ ls -la")
    expect(out).toContain(`${ansiCode(COLORS.primary)}$ ls -la`)
  })
})