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

describe("bashRequiresApproval — shipped defaults", () => {
  it("runs a read-only default with no configuration at all", () => {
    expect(bashRequiresApproval({ command: "ls -la" }, { projectPath: proj })).toBe(false)
    expect(bashRequiresApproval({ command: "git status --short" }, { projectPath: proj })).toBe(false)
    expect(bashRequiresApproval({ command: "git diff HEAD~1" }, { projectPath: proj })).toBe(false)
  })

  it("still asks when an explicit empty allowlist opts out of the defaults", () => {
    expect(
      bashRequiresApproval({ command: "ls" }, { projectPath: proj, silentBashCommands: [] }),
    ).toBe(true)
  })

  it("keeps the defaults when the user adds their own entries", () => {
    expect(
      bashRequiresApproval({ command: "ls" }, { projectPath: proj, silentBashCommands: ["npm"] }),
    ).toBe(false)
    expect(
      bashRequiresApproval({ command: "npm test" }, { projectPath: proj, silentBashCommands: ["npm"] }),
    ).toBe(false)
  })

  it("does not let a multi-word entry cover its siblings", () => {
    expect(
      bashRequiresApproval(
        { command: "git status" },
        { projectPath: proj, silentBashCommands: ["git status", "git push"] },
      ),
    ).toBe(false)
    expect(
      bashRequiresApproval(
        { command: "git status --short" },
        { projectPath: proj, silentBashCommands: ["git status"] },
      ),
    ).toBe(false)
    expect(
      bashRequiresApproval(
        { command: "git stash" },
        { projectPath: proj, silentBashCommands: ["git status"] },
      ),
    ).toBe(true)
  })

  it("checks every segment of a chain", () => {
    expect(
      bashRequiresApproval({ command: "git status | tail -5" }, { projectPath: proj }),
    ).toBe(false)
    expect(
      bashRequiresApproval({ command: "git status && npm test" }, { projectPath: proj }),
    ).toBe(true)
    expect(
      bashRequiresApproval({ command: "git status; rm -rf /" }, { projectPath: proj }),
    ).toBe(true)
    expect(
      bashRequiresApproval({ command: "ls\nrm -rf /" }, { projectPath: proj }),
    ).toBe(true)
  })

  it("asks when shell syntax cannot be split safely", () => {
    expect(
      bashRequiresApproval({ command: "ls $(rm -rf /)" }, { projectPath: proj }),
    ).toBe(true)
    expect(
      bashRequiresApproval({ command: "ls `git push`" }, { projectPath: proj }),
    ).toBe(true)
  })

  it("asks when an allowlisted command reaches a destructive verb", () => {
    expect(
      bashRequiresApproval({ command: "find . -exec rm {} \\;" }, { projectPath: proj }),
    ).toBe(true)
    expect(
      bashRequiresApproval({ command: "find . -delete" }, { projectPath: proj }),
    ).toBe(true)
    expect(
      bashRequiresApproval({ command: "git log --grep rm" }, { projectPath: proj }),
    ).toBe(true)
  })

  it("keeps commands that can write out of the defaults", () => {
    expect(
      bashRequiresApproval({ command: "echo hi > src/app.ts" }, { projectPath: proj }),
    ).toBe(true)
    expect(
      bashRequiresApproval({ command: "git branch -D feature" }, { projectPath: proj }),
    ).toBe(true)
    expect(
      bashRequiresApproval({ command: "cat notes.md > src/app.ts" }, { projectPath: proj }),
    ).toBe(true)
    expect(
      bashRequiresApproval({ command: "git log > notes.md" }, { projectPath: proj }),
    ).toBe(true)
    expect(
      bashRequiresApproval({ command: "cat notes.md | tee copy.md" }, { projectPath: proj }),
    ).toBe(true)
  })

  it("treats descriptor duplication as a read, since it writes no file", () => {
    expect(
      bashRequiresApproval({ command: "cat notes.md 2>&1" }, { projectPath: proj }),
    ).toBe(false)
  })

  it("does not silence a default that touches a sensitive path", () => {
    expect(bashRequiresApproval({ command: "cat .env" }, { projectPath: proj })).toBe(true)
  })
})

describe("bashRequiresApproval — Command Grants", () => {
  const projectPath = proj

  it("runs the exact granted command without asking", () => {
    expect(
      bashRequiresApproval(
        { command: "docker compose up --build -d" },
        { projectPath, approvalGrants: new Set(["docker compose up --build -d"]) },
      ),
    ).toBe(false)
  })

  it("matches the grant across whitespace differences", () => {
    expect(
      bashRequiresApproval(
        { command: "docker  compose up   --build -d" },
        { projectPath, approvalGrants: new Set(["docker compose up --build -d"]) },
      ),
    ).toBe(false)
  })

  it("does not grant a sibling command", () => {
    expect(
      bashRequiresApproval(
        { command: "docker compose down -v" },
        { projectPath, approvalGrants: new Set(["docker compose up --build -d"]) },
      ),
    ).toBe(true)
  })

  it("outranks the Destructive Verbs, because it is per-command consent", () => {
    expect(
      bashRequiresApproval(
        { command: "rm -rf build" },
        { projectPath, approvalGrants: new Set(["rm -rf build"]) },
      ),
    ).toBe(false)
  })

  it("cannot authorise a working directory its user never saw", () => {
    expect(
      bashRequiresApproval(
        { command: "cat notes.md", cwd: "../" },
        { projectPath, approvalGrants: new Set(["cat notes.md"]) },
      ),
    ).toBe(true)
  })
})