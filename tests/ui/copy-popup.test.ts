import { describe, expect, it } from "bun:test"
import { COPY_PREVIEW_LINES, copyPreviewLines } from "@/ui/copy-popup"

describe("copy preview", () => {
  it("keeps short text intact", () => {
    expect(copyPreviewLines("first answer\nsecond answer", 40)).toEqual([
      "first answer",
      "second answer",
    ])
  })

  it("elides lines past the preview limit", () => {
    const text = Array.from({ length: COPY_PREVIEW_LINES + 2 }, (_, index) => `line ${index}`).join(
      "\n",
    )
    const preview = copyPreviewLines(text, 40)

    expect(preview).toHaveLength(COPY_PREVIEW_LINES + 1)
    expect(preview.at(-1)).toBe("…")
    expect(preview[0]).toBe("line 0")
  })

  it("cuts wide lines to the popup's inner width", () => {
    expect(copyPreviewLines("abcdefghijklmnop", 8)).toEqual(["abcdefg…"])
  })

  it("treats Windows line endings as new lines", () => {
    expect(copyPreviewLines("one\r\ntwo", 20)).toEqual(["one", "two"])
  })
})
