import { describe, it, expect } from "bun:test"
import { parseArgs, formatHelp } from "./cli"

describe("parseArgs", () => {
  it("returns defaults for empty args", () => {
    const result = parseArgs([])
    expect(result.directory).toBeUndefined()
    expect(result.model).toBeUndefined()
    expect(result.system).toBeUndefined()
    expect(result.help).toBe(false)
    expect(result.new).toBe(false)
    expect(result.sessions).toBe(false)
    expect(result.resume).toBeUndefined()
  })

  it("parses directory as first positional arg", () => {
    const result = parseArgs(["./my-project"])
    expect(result.directory).toBe("./my-project")
  })

  it("parses --model flag", () => {
    const result = parseArgs(["--model", "anthropic/claude-sonnet-4"])
    expect(result.model).toBe("anthropic/claude-sonnet-4")
  })

  it("parses --system flag", () => {
    const result = parseArgs(["--system", "./prompt.md"])
    expect(result.system).toBe("./prompt.md")
  })

  it("parses --help flag", () => {
    const result = parseArgs(["--help"])
    expect(result.help).toBe(true)
  })

  it("parses --new flag", () => {
    const result = parseArgs(["--new"])
    expect(result.new).toBe(true)
  })

  it("parses --sessions flag", () => {
    const result = parseArgs(["--sessions"])
    expect(result.sessions).toBe(true)
  })

  it("parses --resume flag with ID", () => {
    const result = parseArgs(["--resume", "abc123"])
    expect(result.resume).toBe("abc123")
  })

  it("parses combined flags and directory", () => {
    const result = parseArgs([
      "./my-project",
      "--model", "openai/gpt-4o",
      "--system", "./prompt.md",
    ])
    expect(result.directory).toBe("./my-project")
    expect(result.model).toBe("openai/gpt-4o")
    expect(result.system).toBe("./prompt.md")
  })

  it("ignores unknown flags gracefully", () => {
    const result = parseArgs(["--unknown", "value", "./dir"])
    expect(result.directory).toBe("./dir")
  })
})

describe("formatHelp", () => {
  it("returns a non-empty string", () => {
    const help = formatHelp()
    expect(help.length).toBeGreaterThan(0)
  })

  it("mentions all CLI flags", () => {
    const help = formatHelp()
    expect(help).toContain("--model")
    expect(help).toContain("--system")
    expect(help).toContain("--new")
    expect(help).toContain("--sessions")
    expect(help).toContain("--resume")
    expect(help).toContain("--help")
  })
})
