import { describe, it, expect } from "bun:test"
import { isSensitivePath, pathRequiresApproval, fileToolApprovalKey, DEFAULT_SENSITIVE_PATTERNS } from "@/core/sensitive-files"
import { join, basename } from "path"

describe("sensitive-files", () => {
  describe("default patterns", () => {
    it("marks .env as sensitive", () => {
      expect(isSensitivePath(".env")).toBe(true)
    })

    it("marks .env variants as sensitive", () => {
      expect(isSensitivePath(".env.local")).toBe(true)
      expect(isSensitivePath(".env.production")).toBe(true)
    })

    it("marks nested env files as sensitive", () => {
      expect(isSensitivePath("config/.env")).toBe(true)
      expect(isSensitivePath("server/.env.staging")).toBe(true)
    })

    it("does not mark env.example as sensitive", () => {
      expect(isSensitivePath("env.example")).toBe(false)
    })

    it("marks key material as sensitive", () => {
      expect(isSensitivePath("server.pem")).toBe(true)
      expect(isSensitivePath("certs/server.key")).toBe(true)
      expect(isSensitivePath("id_rsa")).toBe(true)
      expect(isSensitivePath(".ssh/id_rsa")).toBe(true)
    })

    it("marks credential stores as sensitive", () => {
      expect(isSensitivePath(".git-credentials")).toBe(true)
    })

    it("marks everything under .ssh as sensitive", () => {
      expect(isSensitivePath(".ssh/authorized_keys")).toBe(true)
      expect(isSensitivePath(".ssh/known_hosts")).toBe(true)
      expect(isSensitivePath("deep/nested/.ssh/id_ed25519")).toBe(true)
    })

    it("does not mark ordinary source files as sensitive", () => {
      expect(isSensitivePath("src/index.ts")).toBe(false)
      expect(isSensitivePath("package.json")).toBe(false)
      expect(isSensitivePath("keyboard.ts")).toBe(false)
      expect(isSensitivePath("src/env.ts")).toBe(false)
    })

    it("normalizes windows-style separators", () => {
      expect(isSensitivePath("config\\.env")).toBe(true)
      expect(isSensitivePath(".ssh\\id_rsa")).toBe(true)
    })
  })

  it("exports the default pattern list", () => {
    expect(DEFAULT_SENSITIVE_PATTERNS.length).toBeGreaterThan(0)
    expect(DEFAULT_SENSITIVE_PATTERNS).toContain(".env")
  })

  it("honors extra patterns alongside defaults", () => {
    expect(isSensitivePath("service-account.json", ["service-account.json"])).toBe(true)
    expect(isSensitivePath("secrets/token.txt", ["secrets/**"])).toBe(true)
    expect(isSensitivePath(".env", ["service-account.json"])).toBe(true)
  })

  it("extra patterns do not unmark default-sensitive paths", () => {
    expect(isSensitivePath(".env", ["some-other-file"])).toBe(true)
  })

  describe("pathRequiresApproval", () => {
    const proj = join(import.meta.dir, "__proj")

    it("requires approval when the path argument is missing", () => {
      expect(pathRequiresApproval({}, { projectPath: proj })).toBe(true)
    })

    it("auto-approves in-project normal files", () => {
      expect(pathRequiresApproval({ path: "src/app.ts" }, { projectPath: proj })).toBe(false)
    })

    it("auto-approves in-project nested files", () => {
      expect(pathRequiresApproval({ path: "a/b/c.txt" }, { projectPath: proj })).toBe(false)
    })

    it("requires approval for in-project sensitive paths", () => {
      expect(pathRequiresApproval({ path: ".env" }, { projectPath: proj })).toBe(true)
      expect(pathRequiresApproval({ path: ".ssh/id_rsa" }, { projectPath: proj })).toBe(true)
    })

    it("requires approval for paths outside the project root", () => {
      expect(pathRequiresApproval({ path: "../outside.txt" }, { projectPath: proj })).toBe(true)
      expect(pathRequiresApproval({ path: join(proj, "..", "outside.txt") }, { projectPath: proj })).toBe(true)
    })

    it("requires approval for absolute paths outside the project root", () => {
      expect(pathRequiresApproval({ path: "C:/etc/passwd" }, { projectPath: proj })).toBe(true)
    })

    it("requires approval when a project-root sibling shares the prefix", () => {
      const path = join(proj, "..", `${basename(proj)}-cousin`, "file.ts")
      expect(pathRequiresApproval({ path }, { projectPath: proj })).toBe(true)
    })

    it("honors extra sensitive patterns from the context", () => {
      expect(pathRequiresApproval({ path: "secrets/token.txt" }, { projectPath: proj, sensitivePatterns: ["secrets/**"] })).toBe(true)
    })
  })

  describe("fileToolApprovalKey", () => {
    const proj = join(import.meta.dir, "__proj")

    it("returns null for non-file tools", () => {
      expect(fileToolApprovalKey("bash", { command: "ls" }, proj)).toBeNull()
    })

    it("returns null when the path argument is missing or empty", () => {
      expect(fileToolApprovalKey("read_file", {}, proj)).toBeNull()
      expect(fileToolApprovalKey("write_file", { path: "" }, proj)).toBeNull()
      expect(fileToolApprovalKey("edit_file", { path: "   " }, proj)).toBeNull()
    })

    it("resolves the declared path for read, write, and edit", () => {
      expect(fileToolApprovalKey("read_file", { path: "src/app.ts" }, proj)).toBe(join(proj, "src", "app.ts"))
      expect(fileToolApprovalKey("write_file", { path: ".env" }, proj)).toBe(join(proj, ".env"))
      expect(fileToolApprovalKey("edit_file", { path: "../outside.txt" }, proj)).toBe(join(proj, "..", "outside.txt"))
    })
  })
})
