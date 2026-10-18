import React from "react"
import { describe, it, expect } from "bun:test"
import { render } from "ink-testing-library"
import { renderToString } from "ink"
import { FileSuggestion, FILE_SUGGESTION_HINT, NO_FILES_MATCH_MESSAGE } from "@/ui/file-suggestion"
import { COLORS } from "@/ui/theme"
import { ansiCode } from "@/ui/ansi-test"

const files = ["src/app.ts", "src/chat-panel.tsx", "app.test.tsx"]

/** The frame with color codes gone, so adjacent runs read as one string. */
function plain(frame: string | undefined): string {
  return (frame ?? "").replace(/\u001B\[[0-9;]*m/g, "")
}

describe("FileSuggestion", () => {
  it("lists every offered file with its @ prefix", () => {
    const { lastFrame } = render(<FileSuggestion items={files} highlightIndex={0} />)
    const frame = plain(lastFrame())
    for (const file of files) {
      expect(frame).toContain(`@${file}`)
    }
  })

  it("renders only the items it is given", () => {
    const { lastFrame } = render(<FileSuggestion items={[files[1]!]} highlightIndex={0} />)
    const frame = plain(lastFrame())
    expect(frame).toContain("@src/chat-panel.tsx")
    expect(frame).not.toContain("@src/app.ts")
    expect(frame).not.toContain("@app.test.tsx")
  })

  it("marks the highlighted file with > and others without", () => {
    const { lastFrame } = render(<FileSuggestion items={files} highlightIndex={1} />)
    const frame = plain(lastFrame())
    expect(frame).toContain("> @src/chat-panel.tsx")
    expect(frame).not.toContain("> @src/app.ts")
    expect(frame).not.toContain("> @app.test.tsx")
  })

  it("shows the no-match message instead of vanishing when there are no items", () => {
    const { lastFrame } = render(<FileSuggestion items={[]} highlightIndex={0} />)
    const frame = plain(lastFrame())
    expect(frame).toContain(NO_FILES_MATCH_MESSAGE)
  })

  it("always spells out how to accept or dismiss a suggestion", () => {
    const { lastFrame } = render(<FileSuggestion items={files} highlightIndex={0} />)
    expect(plain(lastFrame())).toContain(FILE_SUGGESTION_HINT)
  })

  it("colors the highlight and the hint from the palette tokens", () => {
    const frame = renderToString(<FileSuggestion items={files} highlightIndex={2} />, { columns: 100 })
    expect(frame).toContain("app.test.tsx")
    expect(frame).toContain(ansiCode(COLORS.primary))
    expect(frame).toContain(ansiCode(COLORS.muted))
  })
})
