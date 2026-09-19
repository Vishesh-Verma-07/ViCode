import { describe, it, expect, beforeEach, afterEach } from "bun:test"
import { readFileTool } from "@/tools/read-file"
import { mkdirSync, writeFileSync, rmSync, existsSync } from "fs"
import { join } from "path"
import type { ToolContext } from "@/core/types"

const tmpDir = join(import.meta.dir, "__tmp_read_file_test")
const outsideDir = join(tmpDir, "..", "__tmp_read_file_outside")

beforeEach(() => {
  if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true })
  mkdirSync(tmpDir, { recursive: true })
})

afterEach(() => {
  if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true })
  if (existsSync(outsideDir)) rmSync(outsideDir, { recursive: true })
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

  it("reads files outside the project root", async () => {
    mkdirSync(outsideDir, { recursive: true })
    writeFileSync(join(outsideDir, "outside.txt"), "outside content")
    const result = await readFileTool.execute({ path: join(tmpDir, "..", "__tmp_read_file_outside", "outside.txt") }, ctx)
    expect(result).toBe("outside content")
  })

  it("reads empty file", async () => {
    writeFileSync(join(tmpDir, "empty.txt"), "")
    const result = await readFileTool.execute({ path: "empty.txt" }, ctx)
    expect(result).toBe("")
  })

  it("reads sensitive files; they are gated by approval, not refused in-tool", async () => {
    writeFileSync(join(tmpDir, ".env"), "SECRET_KEY=hunter2")
    const result = await readFileTool.execute({ path: ".env" }, ctx)
    expect(result).toBe("SECRET_KEY=hunter2")
  })

  it("reads nested sensitive files once approval has been granted", async () => {
    mkdirSync(join(tmpDir, ".ssh"), { recursive: true })
    writeFileSync(join(tmpDir, ".ssh", "id_rsa"), "PRIVATE MATERIAL")
    const result = await readFileTool.execute({ path: ".ssh/id_rsa" }, ctx)
    expect(result).toContain("PRIVATE MATERIAL")
  })

  it("honors extra sensitive patterns from context at the policy layer", async () => {
    writeFileSync(join(tmpDir, "creds.json"), "{}")
    const ctxExtra: ToolContext = { projectPath: tmpDir, sensitivePatterns: ["creds.json"] }
    const result = await readFileTool.execute({ path: "creds.json" }, ctxExtra)
    expect(result).toBe("{}")
  })

  describe("approval policy", () => {
    it("auto-approves reads of normal in-project files", async () => {
      const needs = await readFileTool.requiresApproval?.({ path: "src/app.ts" }, ctx)
      expect(needs).toBe(false)
    })

    it("requires approval for reads of .env", async () => {
      const needs = await readFileTool.requiresApproval?.({ path: ".env" }, ctx)
      expect(needs).toBe(true)
    })

    it("requires approval for reads of nested secret files", async () => {
      const needs = await readFileTool.requiresApproval?.({ path: "config/server.key" }, ctx)
      expect(needs).toBe(true)
    })

    it("requires approval for reads outside the project root", async () => {
      const needs = await readFileTool.requiresApproval?.({ path: "../outside.txt" }, ctx)
      expect(needs).toBe(true)
    })

    it("requires approval when the path argument is missing", async () => {
      const needs = await readFileTool.requiresApproval?.({}, ctx)
      expect(needs).toBe(true)
    })
  })
})
