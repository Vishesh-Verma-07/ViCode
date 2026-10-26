import { describe, it, expect, beforeEach } from "bun:test"
import { createApprovedPaths } from "@/core/approved-paths"

describe("approved-paths", () => {
  const approvals = createApprovedPaths()

  beforeEach(() => {
    approvals.clear()
  })

  it("starts each Tab with no approved paths", () => {
    expect(approvals.isApproved("/project/src/app.ts")).toBe(false)
    expect(approvals.isApproved("/project/.env")).toBe(false)
  })

  it("remembers an approved resolved path", () => {
    approvals.approve("/project/src/app.ts")
    expect(approvals.isApproved("/project/src/app.ts")).toBe(true)
  })

  it("does not approve a different resolved path", () => {
    approvals.approve("/project/a.txt")
    expect(approvals.isApproved("/project/b.txt")).toBe(false)
  })

  it("keeps approval memory isolated between Tabs", () => {
    const otherTab = createApprovedPaths()
    approvals.approve("/project/secret/.env")
    expect(otherTab.isApproved("/project/secret/.env")).toBe(false)
  })

  it("clears all approved paths when the Tab changes Sessions", () => {
    approvals.approve("/project/secret/.env")
    approvals.approve("/project/outside.txt")
    approvals.clear()
    expect(approvals.isApproved("/project/secret/.env")).toBe(false)
    expect(approvals.isApproved("/project/outside.txt")).toBe(false)
  })

  it("lists the paths approved during the Tab", () => {
    approvals.approve("/project/.env")
    approvals.approve("/project/outside.txt")
    expect(approvals.list().sort()).toEqual(["/project/.env", "/project/outside.txt"])
  })

  it("revokes one approved path and leaves the rest", () => {
    approvals.approve("/project/.env")
    approvals.approve("/project/outside.txt")
    approvals.revoke("/project/.env")
    expect(approvals.isApproved("/project/.env")).toBe(false)
    expect(approvals.isApproved("/project/outside.txt")).toBe(true)
  })

  it("matches on the exact resolved path string it was given", () => {
    approvals.approve("/project/sub/target.txt")
    expect(approvals.isApproved("/project/sub/target.txt")).toBe(true)
    expect(approvals.isApproved("/project/sub/other.txt")).toBe(false)
  })

  it("matches case-insensitively on Windows", () => {
    if (process.platform !== "win32") return
    approvals.approve("C:/Project/.Env")
    expect(approvals.isApproved("c:/project/.env")).toBe(true)
  })
})
