import { describe, it, expect } from "bun:test"
import { parseDiff } from "@/ui/diff"

describe("parseDiff", () => {
  it("extracts old and new file paths, stripping a/ b/ prefixes", () => {
    const parsed = parseDiff("--- a/src/app.ts\n+++ b/src/app.ts\n@@ -1 +1 @@\n-old\n+new")
    expect(parsed.oldPath).toBe("src/app.ts")
    expect(parsed.newPath).toBe("src/app.ts")
  })

  it("keeps non-prefixed paths verbatim", () => {
    const parsed = parseDiff("--- src/app.ts\n+++ src/app.ts\n@@ -1 +1 @@\n-old\n+new")
    expect(parsed.oldPath).toBe("src/app.ts")
    expect(parsed.newPath).toBe("src/app.ts")
  })

  it("counts added and removed lines while ignoring ---/+++ headers", () => {
    const parsed = parseDiff(`--- a/app.ts
+++ b/app.ts
@@ -1,3 +1,2 @@
 line1
-old line
-other old
+line1 changed
 line3
+line3 changed`)
    expect(parsed.added).toBe(2)
    expect(parsed.removed).toBe(2)
  })

  it("assigns old/new line numbers from a single-range hunk header", () => {
    const parsed = parseDiff("--- a/app.ts\n+++ b/app.ts\n@@ -1,4 +1,4 @@\n line1\n-old2\n+new2\n line3\n line4")
    const lines = parsed.lines
    expect(lines[0]).toMatchObject({ kind: "header", oldLine: null, newLine: null })
    expect(lines[1]).toMatchObject({ kind: "header", oldLine: null, newLine: null })
    expect(lines[2]).toMatchObject({ kind: "hunk", oldLine: null, newLine: null })
    expect(lines[3]).toMatchObject({ kind: "context", oldLine: 1, newLine: 1 })
    expect(lines[4]).toMatchObject({ kind: "remove", oldLine: 2, newLine: null })
    expect(lines[5]).toMatchObject({ kind: "add", oldLine: null, newLine: 2 })
    expect(lines[6]).toMatchObject({ kind: "context", oldLine: 3, newLine: 3 })
    expect(lines[7]).toMatchObject({ kind: "context", oldLine: 4, newLine: 4 })
  })

  it("handles hunk headers without counts (git -1 +1 form)", () => {
    const parsed = parseDiff("--- a/app.ts\n+++ b/app.ts\n@@ -1 +1 @@\n-old\n+new")
    expect(parsed.removed).toBe(1)
    expect(parsed.added).toBe(1)
    expect(parsed.lines[2]!.kind).toBe("hunk")
  })

  it("advances line numbers across multiple hunks", () => {
    const parsed = parseDiff(`--- a/app.ts
+++ b/app.ts
@@ -1,2 +1,2 @@
 before
-after
+after2
@@ -10,3 +10,3 @@
 at ten
-old
+new
 at twelve`)
    const contextAtTen = parsed.lines.find((l) => l.kind === "context" && l.text === " at ten")
    expect(contextAtTen).toMatchObject({ oldLine: 10, newLine: 10 })
    const removed = parsed.lines.find((l) => l.kind === "remove" && l.text === "-old")
    expect(removed).toMatchObject({ oldLine: 11, newLine: null })
    const added = parsed.lines.find((l) => l.kind === "add" && l.text === "+new")
    expect(added).toMatchObject({ oldLine: null, newLine: 11 })
  })

  it("treats \\ no-newline lines as meta without line numbers", () => {
    const parsed = parseDiff(`--- a/app.ts
+++ b/app.ts
@@ -1,2 +1,2 @@
 line1
\\ No newline at end of file
+line2`)
    const meta = parsed.lines.find((l) => l.kind === "meta")
    expect(meta).toBeDefined()
    expect(meta!.oldLine).toBeNull()
    expect(meta!.newLine).toBeNull()
  })

  it("skips the git Index: and ==== preamble lines", () => {
    const parsed = parseDiff(`Index: src/app.ts
===================================================================
--- src/app.ts
+++ src/app.ts
@@ -1,4 +1,4 @@
 line1
-old
+new
 line3`)
    expect(parsed.lines.some((l) => l.kind === "header")).toBe(true)
    expect(parsed.lines.some((l) => l.text.includes("Index:"))).toBe(false)
    expect(parsed.lines.some((l) => /^=+$/.test(l.text))).toBe(false)
    expect(parsed.lines.length).toBe(7)
  })

  it("returns an empty result for an empty diff", () => {
    const parsed = parseDiff("")
    expect(parsed.added).toBe(0)
    expect(parsed.removed).toBe(0)
    expect(parsed.lines).toEqual([])
  })

  it("preserves raw line text on every parsed line", () => {
    const parsed = parseDiff("--- a/x\n+++ b/x\n@@ -1 +1 @@\n old\n+added\n-removed")
    expect(parsed.lines.map((l) => l.text)).toEqual([
      "--- a/x",
      "+++ b/x",
      "@@ -1 +1 @@",
      " old",
      "+added",
      "-removed",
    ])
  })
})