import { describe, it, expect } from "bun:test"
import { extractDiff } from "./app"

describe("extractDiff", () => {
  it("returns result as-is when no diff markers present", () => {
    const result = "File edited successfully: app.ts"
    const { message, diff } = extractDiff(result)
    expect(message).toBe(result)
    expect(diff).toBeNull()
  })

  it("extracts diff from tool result with markers", () => {
    const diffContent = "--- a/app.ts\n+++ b/app.ts\n@@ -1 +1 @@\n-old\n+new"
    const result = `File edited successfully: app.ts\n__DIFF_START__\n${diffContent}__DIFF_END__`
    const { message, diff } = extractDiff(result)
    expect(message).toBe("File edited successfully: app.ts")
    expect(diff).toBe(diffContent)
  })

  it("handles result with only diff markers", () => {
    const diffContent = "--- a.txt\n+++ b.txt\n@@ -1 +1 @@\n-old\n+new"
    const result = `__DIFF_START__\n${diffContent}__DIFF_END__`
    const { message, diff } = extractDiff(result)
    expect(message).toBe("")
    expect(diff).toBe(diffContent)
  })

  it("returns null diff when only start marker exists", () => {
    const result = "Some message\n__DIFF_START__\npartial"
    const { message, diff } = extractDiff(result)
    expect(message).toBe(result)
    expect(diff).toBeNull()
  })

  it("returns null diff when only end marker exists", () => {
    const result = "Some message\n__DIFF_END__"
    const { message, diff } = extractDiff(result)
    expect(message).toBe(result)
    expect(diff).toBeNull()
  })

  it("handles multiline diff content", () => {
    const diffContent = `--- a/file.ts
+++ b/file.ts
@@ -1,3 +1,3 @@
 line1
-old line
+new line
 line3`
    const result = `File edited successfully: file.ts\n__DIFF_START__\n${diffContent}__DIFF_END__`
    const { message, diff } = extractDiff(result)
    expect(message).toBe("File edited successfully: file.ts")
    expect(diff).toBe(diffContent)
    expect(diff!.split("\n").length).toBe(7)
  })
})
