import { describe, it, expect, beforeEach, afterEach } from "bun:test"
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs"
import { join } from "path"
import { tmpdir } from "os"
import {
  grantCommand,
  loadCommandGrants,
  normalizeCommand,
  revokeCommand,
} from "@/core/approval-grants"

let dir: string
let trustFile: string
let previous: string | undefined

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "vicode-trust-"))
  trustFile = join(dir, "trust.json")
  previous = process.env.VICODE_TRUST_FILE
  process.env.VICODE_TRUST_FILE = trustFile
})

afterEach(() => {
  if (previous === undefined) delete process.env.VICODE_TRUST_FILE
  else process.env.VICODE_TRUST_FILE = previous
  rmSync(dir, { recursive: true, force: true })
})

describe("approval-grants", () => {
  it("normalizes whitespace so one command has one spelling", () => {
    expect(normalizeCommand("  docker   compose up  ")).toBe("docker compose up")
  })

  it("persists a grant for this project and loads it back", () => {
    const live = new Set<string>()
    expect(grantCommand("/project/a", "docker compose up --build -d", live)).toBe(true)
    expect(live.has("docker compose up --build -d")).toBe(true)

    const loaded = loadCommandGrants("/project/a")
    expect([...loaded]).toEqual(["docker compose up --build -d"])
  })

  it("scopes grants to the project they were given in", () => {
    grantCommand("/project/a", "npm publish", new Set())
    expect([...loadCommandGrants("/project/a")]).toEqual(["npm publish"])
    expect([...loadCommandGrants("/project/b")]).toEqual([])
  })

  it("revokes a grant from the live set and from disk", () => {
    const live = new Set<string>()
    grantCommand("/project/a", "npm publish", live)
    grantCommand("/project/a", "npm test", live)

    expect(revokeCommand("/project/a", "npm publish", live)).toBe(true)
    expect(live.has("npm publish")).toBe(false)
    expect([...loadCommandGrants("/project/a")]).toEqual(["npm test"])
  })

  it("ignores a malformed trust file rather than failing the Session", () => {
    writeFileSync(trustFile, "{ not json")
    expect([...loadCommandGrants("/project/a")]).toEqual([])
    expect(grantCommand("/project/a", "ls", new Set())).toBe(true)
    expect([...loadCommandGrants("/project/a")]).toEqual(["ls"])
  })

  it("treats whitespace variants as the same grant", () => {
    grantCommand("/project/a", "docker  compose up", new Set())
    expect([...loadCommandGrants("/project/a")]).toEqual(["docker compose up"])
  })

  it("writes the trust file outside the project", () => {
    grantCommand("/project/a", "ls", new Set())
    const parsed = JSON.parse(readFileSync(trustFile, "utf-8")) as {
      projects: Record<string, string[]>
    }
    expect(Object.values(parsed.projects)).toEqual([["ls"]])
  })
})
