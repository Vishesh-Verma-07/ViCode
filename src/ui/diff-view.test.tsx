import React from "react"
import { describe, it, expect } from "bun:test"
import { render } from "ink-testing-library"
import { renderToString } from "ink"
import { DiffView } from "./diff-view"
import { COLORS } from "./theme"
import { ansiCode } from "./ansi-test"

const SAMPLE_DIFF = `Index: src/app.ts
===================================================================
--- src/app.ts
+++ src/app.ts
@@ -1,4 +1,4 @@
 line1
-old line
+line1 changed
 line3
 line4`

function frame(instance: { lastFrame: () => string | undefined }): string {
  return instance.lastFrame() ?? ""
}

describe("DiffView", () => {
  it("shows a stats header with the file path and +N -M tallies in green and red", () => {
    const inst = render(<DiffView diff={SAMPLE_DIFF} />)
    const out = frame(inst)
    expect(out).toContain("src/app.ts")
    expect(out).toContain(`+1`)
    expect(out).toContain(`-1`)
    expect(out).toContain(ansiCode(COLORS.success))
    expect(out).toContain(ansiCode(COLORS.error))
    inst.unmount()
  })

  it("renders the diff inside a framed Code Block region", () => {
    const inst = render(<DiffView diff={SAMPLE_DIFF} />)
    expect(/[┌└]/.test(frame(inst))).toBe(true)
    inst.unmount()
  })

  it("shows a dim line-number gutter (│) on each diff line", () => {
    const inst = render(<DiffView diff={SAMPLE_DIFF} />)
    const out = frame(inst)
    expect(out).toContain("│")
    inst.unmount()
  })

  it("keeps the + / - / @@ line colors via ANSI codes inside the frame", () => {
    const inst = render(<DiffView diff={SAMPLE_DIFF} />)
    const out = frame(inst)
    expect(out).toContain(ansiCode(COLORS.success))
    expect(out).toContain(ansiCode(COLORS.error))
    expect(out).toContain(ansiCode(COLORS.primary))
    inst.unmount()
  })

  it("omits the git Index: / === preamble so the frame is clean", () => {
    const inst = render(<DiffView diff={SAMPLE_DIFF} />)
    const out = frame(inst)
    expect(out).not.toContain("Index:")
    expect(out).not.toContain("====")
    inst.unmount()
  })

  it("paints the stats header with green +N directly when rendered to a string", () => {
    const out = renderToString(<DiffView diff={SAMPLE_DIFF} />, { columns: 100 })
    expect(out).toContain("src/app.ts")
    expect(out).toContain(`+1`)
    expect(out).toContain(`-1`)
    expect(out).toContain(ansiCode(COLORS.success) + `+1`)
    expect(out).toContain(ansiCode(COLORS.error) + `-1`)
  })
})