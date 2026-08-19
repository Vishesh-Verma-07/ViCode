import { describe, it, expect, beforeEach, afterEach } from "bun:test"
import { editFileTool } from "./edit-file"
import { mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from "fs"
import { join } from "path"
import type { ToolContext } from "../core/types"

const tmpDir = join(import.meta.dir, "__tmp_edit_file_test")

beforeEach(() => {
  if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true })
  mkdirSync(tmpDir, { recursive: true })
})

afterEach(() => {
  if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true })
})

const ctx: ToolContext = { projectPath: tmpDir }

describe("edit_file tool", () => {
  it("has correct metadata", () => {
    expect(editFileTool.name).toBe("edit_file")
    expect(editFileTool.dangerous).toBe(true)
    expect(editFileTool.description).toContain("Edit")
  })

  it("replaces text in a file", async () => {
    writeFileSync(join(tmpDir, "app.ts"), "const x = 1\nconst y = 2")
    const result = await editFileTool.execute(
      { path: "app.ts", oldText: "const x = 1", newText: "const x = 10" },
      ctx,
    )
    expect(result).toContain("app.ts")
    const content = readFileSync(join(tmpDir, "app.ts"), "utf-8")
    expect(content).toBe("const x = 10\nconst y = 2")
  })

  it("returns error when oldText not found", async () => {
    writeFileSync(join(tmpDir, "app.ts"), "const x = 1")
    const result = await editFileTool.execute(
      { path: "app.ts", oldText: "const z = 999", newText: "const z = 1" },
      ctx,
    )
    expect(result).toContain("Error")
    expect(result).toContain("not found")
  })

  it("returns error for missing file", async () => {
    const result = await editFileTool.execute(
      { path: "nope.ts", oldText: "a", newText: "b" },
      ctx,
    )
    expect(result).toContain("Error")
  })

  it("rejects paths outside project", async () => {
    const result = await editFileTool.execute(
      { path: "/etc/passwd", oldText: "a", newText: "b" },
      ctx,
    )
    expect(result).toContain("Error")
  })

  it("replaces all occurrences of oldText", async () => {
    writeFileSync(join(tmpDir, "dup.ts"), "foo\nfoo\nfoo")
    const result = await editFileTool.execute(
      { path: "dup.ts", oldText: "foo", newText: "bar" },
      ctx,
    )
    expect(result).toContain("dup.ts")
    const content = readFileSync(join(tmpDir, "dup.ts"), "utf-8")
    expect(content).toBe("bar\nbar\nbar")
  })

  it("works with multiline oldText", async () => {
    writeFileSync(join(tmpDir, "multi.ts"), "line1\nline2\nline3")
    const result = await editFileTool.execute(
      { path: "multi.ts", oldText: "line1\nline2", newText: "new1\nnew2\nnew3" },
      ctx,
    )
    expect(result).toContain("multi.ts")
    const content = readFileSync(join(tmpDir, "multi.ts"), "utf-8")
    expect(content).toBe("new1\nnew2\nnew3\nline3")
  })

  it("includes diff markers in result", async () => {
    writeFileSync(join(tmpDir, "diff.ts"), "hello\nworld")
    const result = await editFileTool.execute(
      { path: "diff.ts", oldText: "world", newText: "universe" },
      ctx,
    )
    expect(result).toContain("__DIFF_START__")
    expect(result).toContain("__DIFF_END__")
    expect(result).toContain("--- diff.ts")
    expect(result).toContain("+++ diff.ts")
    expect(result).toContain("-world")
    expect(result).toContain("+universe")
  })
})
