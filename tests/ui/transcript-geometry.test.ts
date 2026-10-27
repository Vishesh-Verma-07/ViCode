import { describe, it, expect } from "bun:test"
import { messageIdAtLine } from "@/ui/transcript-geometry"

describe("messageIdAtLine", () => {
  const blocks = [
    { lines: 3, messageId: "u1" },
    { lines: 2, messageId: "a1" },
    { lines: 1 }, // a running tool
    { lines: 4, messageId: "u2" },
  ]

  it("names the message whose block contains the line", () => {
    expect(messageIdAtLine(blocks, 0)).toBe("u1")
    expect(messageIdAtLine(blocks, 2)).toBe("u1")
    expect(messageIdAtLine(blocks, 3)).toBe("a1")
    expect(messageIdAtLine(blocks, 6)).toBe("u2")
    expect(messageIdAtLine(blocks, 9)).toBe("u2")
  })

  it("names nothing for a block without a message", () => {
    expect(messageIdAtLine(blocks, 5)).toBeUndefined()
  })

  it("names nothing above or below the transcript", () => {
    expect(messageIdAtLine(blocks, -1)).toBeUndefined()
    expect(messageIdAtLine(blocks, 10)).toBeUndefined()
    expect(messageIdAtLine([], 0)).toBeUndefined()
  })
})
