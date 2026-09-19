import { describe, it, expect } from "bun:test"
import { bashRequiresApproval } from "@/core/bash-allowlist"
import { join } from "path"

const proj = join(import.meta.dir, "__proj")

describe("bashRequiresApproval", () => {
  it("auto-approves an allowlisted first token with clean tokens and cwd", () => {
    expect(
      bashRequiresApproval({ command: "npm test" }, { projectPath: proj, silentBashCommands: ["npm"] }),
    ).toBe(false)
  })

  it("auto-approves a git command when git is allowlisted", () => {
    expect(
      bashRequiresApproval({ command: "git status" }, { projectPath: proj, silentBashCommands: ["git"] }),
    ).toBe(false)
  })

  it("still requires approval when the first token is not allowlisted", () => {
    expect(
      bashRequiresApproval({ command: "rm -rf node_modules" }, { projectPath: proj, silentBashCommands: ["npm"] }),
    ).toBe(true)
  })

  it("requires approval when no allowlist is configured", () => {
    expect(
      bashRequiresApproval({ command: "npm test" }, { projectPath: proj }),
    ).toBe(true)
  })

  it("requires approval when the allowlist is empty", () => {
    expect(
      bashRequiresApproval({ command: "npm test" }, { projectPath: proj, silentBashCommands: [] }),
    ).toBe(true)
  })

  it("requires approval when allowlisted but a token matches a sensitive path", () => {
    expect(
      bashRequiresApproval({ command: "cat .env" }, { projectPath: proj, silentBashCommands: ["cat"] }),
    ).toBe(true)
  })

  it("requires approval when a token redirects into a sensitive path", () => {
    expect(
      bashRequiresApproval({ command: "npm test >.env" }, { projectPath: proj, silentBashCommands: ["npm"] }),
    ).toBe(true)
  })

  it("requires approval when a redirect is glued to another token", () => {
    expect(
      bashRequiresApproval({ command: "npm test>.env" }, { projectPath: proj, silentBashCommands: ["npm"] }),
    ).toBe(true)
  })

  it("requires approval when stderr redirects into a sensitive path", () => {
    expect(
      bashRequiresApproval({ command: "npm run build 2>.env" }, { projectPath: proj, silentBashCommands: ["npm"] }),
    ).toBe(true)
  })

  it("auto-approves when allowlisted and cwd is a normal directory", () => {
    expect(
      bashRequiresApproval({ command: "ls", cwd: "src" }, { projectPath: proj, silentBashCommands: ["ls"] }),
    ).toBe(false)
  })

  it("requires approval when allowlisted and cwd is .ssh", () => {
    expect(
      bashRequiresApproval({ command: "ls", cwd: ".ssh" }, { projectPath: proj, silentBashCommands: ["ls"] }),
    ).toBe(true)
  })

  it("requires approval when allowlisted and cwd is outside the project root", () => {
    expect(
      bashRequiresApproval({ command: "pwd", cwd: "../" }, { projectPath: proj, silentBashCommands: ["pwd"] }),
    ).toBe(true)
  })

  it("honors project-sensitive patterns for tokens", () => {
    expect(
      bashRequiresApproval(
        { command: "cat secrets/token.txt" },
        { projectPath: proj, silentBashCommands: ["cat"], sensitivePatterns: ["secrets/**"] },
      ),
    ).toBe(true)
  })

  it("honors project-sensitive patterns for cwd", () => {
    expect(
      bashRequiresApproval(
        { command: "ls", cwd: "secrets" },
        { projectPath: proj, silentBashCommands: ["ls"], sensitivePatterns: ["secrets/**"] },
      ),
    ).toBe(true)
  })

  it("requires approval when the command is empty", () => {
    expect(
      bashRequiresApproval({ command: "" }, { projectPath: proj, silentBashCommands: ["npm"] }),
    ).toBe(true)
  })
})