import { describe, it, expect, beforeEach, afterEach } from "bun:test"
import { readFileTool } from "./read-file"
import { mkdirSync, writeFileSync, rmSync, existsSync } from "fs"
import { join } from "path"
import type { ToolContext } from "../core/types"

const tmpDir = join(import.meta.dir, "__tmp_read_file_test")

beforeEach(() => {
  if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true })
  mkdirSync(tmpDir, { recursive: true })
})

afterEach(() => {
  if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true })
})

const ctx: ToolContext = { projectPath: tmpDir }

describe("read_file tool", () => {
  it("has correct metadata", () => {
    expect(readFileTool.name).toBe("read_file")
    expect(readFileTool.dangerous).toBe(false)
    expect(readFileTool.description).toContain("file")
  })

  it("reads file contents", async () => {
    writeFileSync(join(tmpDir, "hello.txt"), "hello world")
    const result = await readFileTool.execute({ path: "hello.txt" }, ctx)
    expect(result).toBe("hello world")
  })

  it("returns error for missing file", async () => {
    const result = await readFileTool.execute({ path: "nope.txt" }, ctx)
    expect(result).toContain("Error")
  })

  it("resolves path relative to projectPath", async () => {
    mkdirSync(join(tmpDir, "sub"))
    writeFileSync(join(tmpDir, "sub", "file.ts"), "const x = 1")
    const result = await readFileTool.execute({ path: "sub/file.ts" }, ctx)
    expect(result).toBe("const x = 1")
  })

  it("rejects absolute paths outside project", async () => {
    const result = await readFileTool.execute({ path: "/etc/passwd" }, ctx)
    expect(result).toContain("Error")
  })

  it("reads empty file", async () => {
    writeFileSync(join(tmpDir, "empty.txt"), "")
    const result = await readFileTool.execute({ path: "empty.txt" }, ctx)
    expect(result).toBe("")
  })

  it("refuses to read sensitive files", async () => {
    writeFileSync(join(tmpDir, ".env"), "SECRET_KEY=hunter2")
    const result = await readFileTool.execute({ path: ".env" }, ctx)
    expect(result).toContain("Error")
    expect(result).not.toContain("hunter2")
  })

  it("refuses to read nested sensitive files", async () => {
    mkdirSync(join(tmpDir, ".ssh"), { recursive: true })
    writeFileSync(join(tmpDir, ".ssh", "id_rsa"), "PRIVATE MATERIAL")
    const result = await readFileTool.execute({ path: ".ssh/id_rsa" }, ctx)
    expect(result).toContain("Error")
    expect(result).not.toContain("PRIVATE MATERIAL")
  })

  it("honors extra sensitive patterns from context", async () => {
    writeFileSync(join(tmpDir, "creds.json"), "{}")
    const ctxExtra: ToolContext = { projectPath: tmpDir, sensitivePatterns: ["creds.json"] }
    const result = await readFileTool.execute({ path: "creds.json" }, ctxExtra)
    expect(result).toContain("Error")
  })
})
