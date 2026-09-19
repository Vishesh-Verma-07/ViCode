import { describe, it, expect, beforeEach } from "bun:test"
import { isPathApproved, approvePath, clearApprovedPaths } from "@/core/approved-paths"

describe("approved-paths", () => {
  beforeEach(() => {
    clearApprovedPaths()
  })

  it("starts each turn with no approved paths", () => {
    expect(isPathApproved("/project/src/app.ts")).toBe(false)
    expect(isPathApproved("/project/.env")).toBe(false)
  })

  it("remembers an approved resolved path", () => {
    approvePath("/project/src/app.ts")
    expect(isPathApproved("/project/src/app.ts")).toBe(true)
  })

  it("does not approve a different resolved path", () => {
    approvePath("/project/a.txt")
    expect(isPathApproved("/project/b.txt")).toBe(false)
  })

  it("clears all approved paths at the start of a turn", () => {
    approvePath("/project/secret/.env")
    approvePath("/project/outside.txt")
    clearApprovedPaths()
    expect(isPathApproved("/project/secret/.env")).toBe(false)
    expect(isPathApproved("/project/outside.txt")).toBe(false)
  })

  it("matches on the exact resolved path string it was given", () => {
    approvePath("/project/sub/target.txt")
    expect(isPathApproved("/project/sub/target.txt")).toBe(true)
    expect(isPathApproved("/project/sub/other.txt")).toBe(false)
  })

  it("matches case-insensitively on Windows", () => {
    if (process.platform !== "win32") return
    approvePath("C:/Project/.Env")
    expect(isPathApproved("c:/project/.env")).toBe(true)
  })
})
