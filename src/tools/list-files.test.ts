import { describe, it, expect, beforeEach, afterEach } from "bun:test"
import { listFilesTool } from "./list-files"
import { mkdirSync, writeFileSync, rmSync, existsSync } from "fs"
import { join } from "path"
import type { ToolContext } from "../core/types"

const tmpDir = join(import.meta.dir, "__tmp_list_files_test")

beforeEach(() => {
  if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true })
  mkdirSync(tmpDir, { recursive: true })
})

afterEach(() => {
  if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true })
})

const ctx: ToolContext = { projectPath: tmpDir }

describe("list_files tool", () => {
  it("has correct metadata", () => {
    expect(listFilesTool.name).toBe("list_files")
    expect(listFilesTool.dangerous).toBe(false)
  })

  it("lists files in a directory", async () => {
    writeFileSync(join(tmpDir, "a.txt"), "a")
    writeFileSync(join(tmpDir, "b.txt"), "b")
    const result = await listFilesTool.execute({ path: "." }, ctx)
    expect(result).toContain("a.txt")
    expect(result).toContain("b.txt")
  })

  it("lists subdirectories", async () => {
    mkdirSync(join(tmpDir, "src"))
    writeFileSync(join(tmpDir, "src", "index.ts"), "")
    const result = await listFilesTool.execute({ path: "." }, ctx)
    expect(result).toContain("src/")
  })

  it("supports glob patterns", async () => {
    writeFileSync(join(tmpDir, "a.ts"), "")
    writeFileSync(join(tmpDir, "b.js"), "")
    writeFileSync(join(tmpDir, "c.txt"), "")
    const result = await listFilesTool.execute({ path: "*.ts" }, ctx)
    expect(result).toContain("a.ts")
    expect(result).not.toContain("b.js")
    expect(result).not.toContain("c.txt")
  })

  it("returns error for missing path", async () => {
    const result = await listFilesTool.execute({ path: "nonexistent" }, ctx)
    expect(result).toContain("Error")
  })

  it("lists nested directories", async () => {
    mkdirSync(join(tmpDir, "a", "b"), { recursive: true })
    writeFileSync(join(tmpDir, "a", "b", "deep.txt"), "")
    const result = await listFilesTool.execute({ path: "a" }, ctx)
    expect(result).toContain("b/")
  })
})
