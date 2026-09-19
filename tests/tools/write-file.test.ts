import { describe, it, expect, beforeEach, afterEach } from "bun:test"
import { writeFileTool } from "@/tools/write-file"
import { mkdirSync, readFileSync, rmSync, existsSync } from "fs"
import { join } from "path"
import type { ToolContext } from "@/core/types"

const tmpDir = join(import.meta.dir, "__tmp_write_file_test")
const outsideDir = join(tmpDir, "..", "__tmp_write_file_outside")

beforeEach(() => {
  if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true })
  mkdirSync(tmpDir, { recursive: true })
})

afterEach(() => {
  if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true })
  if (existsSync(outsideDir)) rmSync(outsideDir, { recursive: true })
})

const ctx: ToolContext = { projectPath: tmpDir }

describe("write_file tool", () => {
  it("has correct metadata", () => {
    expect(writeFileTool.name).toBe("write_file")
    expect(writeFileTool.dangerous).toBe(true)
    expect(writeFileTool.description).toContain("write")
  })

  it("writes a new file", async () => {
    const result = await writeFileTool.execute(
      { path: "hello.txt", content: "hello world" },
      ctx,
    )
    expect(result).toContain("hello.txt")
    const content = readFileSync(join(tmpDir, "hello.txt"), "utf-8")
    expect(content).toBe("hello world")
  })

  it("overwrites an existing file", async () => {
    const result = await writeFileTool.execute(
      { path: "hello.txt", content: "new content" },
      ctx,
    )
    expect(result).toContain("hello.txt")
    const content = readFileSync(join(tmpDir, "hello.txt"), "utf-8")
    expect(content).toBe("new content")
  })

  it("creates parent directories", async () => {
    const result = await writeFileTool.execute(
      { path: "src/components/App.tsx", content: "export default () => null" },
      ctx,
    )
    expect(result).toContain("App.tsx")
    const content = readFileSync(join(tmpDir, "src", "components", "App.tsx"), "utf-8")
    expect(content).toBe("export default () => null")
  })

  it("writes empty content", async () => {
    const result = await writeFileTool.execute({ path: "empty.txt", content: "" }, ctx)
    expect(result).toContain("empty.txt")
    const content = readFileSync(join(tmpDir, "empty.txt"), "utf-8")
    expect(content).toBe("")
  })

  it("writes files outside the project root once approved", async () => {
    mkdirSync(outsideDir, { recursive: true })
    const target = join(outsideDir, "outside.txt")
    const result = await writeFileTool.execute({ path: target, content: "bad" }, ctx)
    expect(result).toContain("outside.txt")
    expect(readFileSync(target, "utf-8")).toBe("bad")
  })

  it("includes diff when overwriting existing file", async () => {
    const { writeFileSync } = await import("fs")
    writeFileSync(join(tmpDir, "existing.txt"), "old content")
    const result = await writeFileTool.execute(
      { path: "existing.txt", content: "new content" },
      ctx,
    )
    expect(result).toContain("__DIFF_START__")
    expect(result).toContain("__DIFF_END__")
    expect(result).toContain("--- existing.txt")
    expect(result).toContain("+++ existing.txt")
  })

  it("does not include diff for new files", async () => {
    const result = await writeFileTool.execute(
      { path: "brand-new.txt", content: "fresh content" },
      ctx,
    )
    expect(result).not.toContain("__DIFF_START__")
    expect(result).not.toContain("__DIFF_END__")
  })

  describe("approval policy", () => {
    it("auto-approves writes to normal files", async () => {
      const needs = await writeFileTool.requiresApproval?.({ path: "src/app.ts" }, ctx)
      expect(needs).toBe(false)
    })

    it("requires approval for writes to .env", async () => {
      const needs = await writeFileTool.requiresApproval?.({ path: ".env" }, ctx)
      expect(needs).toBe(true)
    })

    it("requires approval for nested secret files", async () => {
      const needs = await writeFileTool.requiresApproval?.({ path: "config/server.key" }, ctx)
      expect(needs).toBe(true)
    })

    it("honors extra patterns from context", async () => {
      const ctxExtra: ToolContext = { projectPath: tmpDir, sensitivePatterns: ["secrets/**"] }
      const needs = await writeFileTool.requiresApproval?.({ path: "secrets/token.txt" }, ctxExtra)
      expect(needs).toBe(true)
    })

    it("requires approval for writes outside the project root", async () => {
      const needs = await writeFileTool.requiresApproval?.({ path: "../outside.txt" }, ctx)
      expect(needs).toBe(true)
    })

    it("requires approval when the path argument is missing", async () => {
      const needs = await writeFileTool.requiresApproval?.({ content: "x" }, ctx)
      expect(needs).toBe(true)
    })
  })
})
