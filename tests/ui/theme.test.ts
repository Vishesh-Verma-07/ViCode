import { describe, it, expect } from "bun:test"
import { COLORS } from "@/ui/theme"

describe("COLORS palette", () => {
  it("carries the required new tokens", () => {
    expect(COLORS.appBackground).toBe("#000000")
    expect(COLORS.codeBlockShade).toBe("#1a1a1a")
    expect(COLORS.codeBlockBorder).toBe("#333333")
  })

  it("preserves the semantic accent tokens unchanged", () => {
    expect(COLORS.primary).toBe("cyan")
    expect(COLORS.accent).toBe("blue")
    expect(COLORS.success).toBe("green")
    expect(COLORS.warning).toBe("yellow")
    expect(COLORS.error).toBe("red")
  })

  it("contains no dead color tokens (highlight, surface, borderFocused)", () => {
    const keys = Object.keys(COLORS) as string[]
    expect(keys).not.toContain("highlight")
    expect(keys).not.toContain("surface")
    expect(keys).not.toContain("borderFocused")
  })
})
