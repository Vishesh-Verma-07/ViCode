import { describe, it, expect, beforeEach, afterEach } from "bun:test"
import { searchTool } from "./search"
import { mkdirSync, writeFileSync, rmSync, existsSync } from "fs"
import { join } from "path"
import type { ToolContext } from "../core/types"

const tmpDir = join(import.meta.dir, "__tmp_search_test")

beforeEach(() => {
  if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true })
  mkdirSync(tmpDir, { recursive: true })
})

afterEach(() => {
  if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true })
})

const ctx: ToolContext = { projectPath: tmpDir }

describe("search tool", () => {
  it("has correct metadata", () => {
    expect(searchTool.name).toBe("search")
    expect(searchTool.dangerous).toBe(false)
  })

  it("finds a simple string", async () => {
    writeFileSync(join(tmpDir, "a.ts"), "const x = 1\nconst y = 2")
    const result = await searchTool.execute({ query: "const" }, ctx)
    expect(result).toContain("a.ts")
    expect(result).toContain("1")
  })

  it("returns line numbers", async () => {
    writeFileSync(join(tmpDir, "a.ts"), "line1\nline2\ntarget\nline4")
    const result = await searchTool.execute({ query: "target" }, ctx)
    expect(result).toContain("3:")
  })

  it("supports regex patterns", async () => {
    writeFileSync(join(tmpDir, "a.ts"), "foo123\nbar456\nfoo789")
    const result = await searchTool.execute({ query: "foo\\d+" }, ctx)
    expect(result).toContain("foo123")
    expect(result).toContain("foo789")
    expect(result).not.toContain("bar456")
  })

  it("searches across multiple files", async () => {
    writeFileSync(join(tmpDir, "a.ts"), "hello")
    writeFileSync(join(tmpDir, "b.ts"), "hello")
    const result = await searchTool.execute({ query: "hello" }, ctx)
    expect(result).toContain("a.ts")
    expect(result).toContain("b.ts")
  })

  it("returns no-match message when nothing found", async () => {
    writeFileSync(join(tmpDir, "a.ts"), "hello")
    const result = await searchTool.execute({ query: "zzzzz" }, ctx)
    expect(result).toContain("No matches")
  })

  it("skips binary and node_modules", async () => {
    mkdirSync(join(tmpDir, "node_modules"))
    writeFileSync(join(tmpDir, "node_modules", "pkg.ts"), "target")
    writeFileSync(join(tmpDir, "a.ts"), "target")
    const result = await searchTool.execute({ query: "target" }, ctx)
    expect(result).toContain("a.ts")
    expect(result).not.toContain("node_modules")
  })

  it("returns error for bad regex", async () => {
    const result = await searchTool.execute({ query: "[invalid" }, ctx)
    expect(result).toContain("Error")
  })
})
