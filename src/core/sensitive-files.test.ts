import { describe, it, expect } from "bun:test"
import { isSensitivePath, DEFAULT_SENSITIVE_PATTERNS } from "./sensitive-files"

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
})
