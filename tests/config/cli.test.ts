import { describe, it, expect } from "bun:test"
import { parseArgs, formatHelp } from "@/config/cli"
import { listProviders, providerEnvVars } from "@/core/providers"

describe("parseArgs", () => {
  it("returns defaults for empty args", () => {
    const result = parseArgs([])
    expect(result.directory).toBeUndefined()
    expect(result.help).toBe(false)
  })

  it("parses directory as first positional arg", () => {
    const result = parseArgs(["./my-project"])
    expect(result.directory).toBe("./my-project")
  })

  it("parses --help flag", () => {
    const result = parseArgs(["--help"])
    expect(result.help).toBe(true)
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

  it("mentions help option", () => {
    const help = formatHelp()
    expect(help).toContain("--help")
  })

  it("includes usage information", () => {
    const help = formatHelp()
    expect(help).toContain("Usage:")
    expect(help).toContain("directory")
  })

  it("includes configuration documentation", () => {
    const help = formatHelp()
    expect(help).toContain("project (.vicode.json)")
    expect(help).toContain("global (~/.vicode/config.json)")
  })

  it("includes API key documentation", () => {
    const help = formatHelp()
    expect(help).toContain("API key")
  })

  it("documents every variable the registry accepts", () => {
    const help = formatHelp()
    for (const provider of listProviders()) {
      for (const name of providerEnvVars(provider.id)) {
        expect(help).toContain(name)
      }
    }
  })

  it("points keys at the global config and the environment, never the project one", () => {
    // The help used to teach the opposite of the documented rule: it offered
    // `.vicode.json` as a place to put a credential, which is a file meant to
    // be committed (issue #87). Matched on the shape of the line rather than one
    // exact string, so numbering or spacing changes cannot smuggle the claim
    // back in.
    const keyLines = formatHelp()
      .split("\n")
      .filter((line) => line.includes("apiKeys") && line.includes("→"))
    expect(keyLines.length).toBeGreaterThan(0)
    for (const line of keyLines) {
      expect(line).toContain("~/.vicode/config.json")
      expect(line).not.toMatch(/\.vicode\.json\s+in your project/)
    }
  })

  it("names the global config as the only file that takes a key", () => {
    expect(formatHelp()).toContain("~/.vicode/config.json  → { \"apiKeys\"")
  })

  it("says why a key cannot go in a project config", () => {
    const help = formatHelp()
    expect(help).toMatch(/Keys belong in the global config or the environment/)
    expect(help).toMatch(/refused/)
  })

  it("puts the namespaced variable ahead of the provider's own on the same line", () => {
    const line = formatHelp()
      .split("\n")
      .find((candidate) => candidate.includes("VICODE_OPENAI_API_KEY"))
    const tokens = (line ?? "").split(/\s+/)
    expect(tokens.indexOf("VICODE_OPENAI_API_KEY")).toBeLessThan(tokens.indexOf("OPENAI_API_KEY"))
  })
})
