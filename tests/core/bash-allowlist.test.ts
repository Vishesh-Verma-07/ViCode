import { describe, it, expect } from "bun:test"
import { bashRequiresApproval } from "@/core/bash-allowlist"
import { join } from "path"

const proj = join(import.meta.dir, "__proj")

describe("bashRequiresApproval", () => {
  it("auto-approves any command run in the project root", () => {
    expect(bashRequiresApproval({ command: "npm test" }, { projectPath: proj })).toBe(false)
    expect(bashRequiresApproval({ command: "rm -rf node_modules" }, { projectPath: proj })).toBe(false)
  })

  it("auto-approves any command in a nested project directory", () => {
    expect(bashRequiresApproval({ command: "cat .env", cwd: "src" }, { projectPath: proj })).toBe(false)
  })

  it("requires approval when cwd is outside the project root", () => {
    expect(
      bashRequiresApproval({ command: "pwd", cwd: "../" }, { projectPath: proj }),
    ).toBe(true)
  })

  it("requires approval when the command is empty", () => {
    expect(bashRequiresApproval({ command: "" }, { projectPath: proj })).toBe(true)
  })
})