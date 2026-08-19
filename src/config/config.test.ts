import { describe, it, expect, beforeEach, afterEach } from "bun:test"
import { loadConfig } from "./config"
import { mkdirSync, writeFileSync, rmSync, existsSync } from "fs"
import { join } from "path"

const tmpDir = join(import.meta.dir, "__tmp_config_test")

beforeEach(() => {
  if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true })
  mkdirSync(tmpDir, { recursive: true })
})

afterEach(() => {
  if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true })
})

describe("config schema", () => {
  it("accepts empty config", () => {
    const result = loadConfig({ projectPath: tmpDir })
    expect(result.apiKey).toBeUndefined()
    expect(result.model).toBeUndefined()
  })

  it("accepts valid config with all fields", () => {
    writeFileSync(
      join(tmpDir, ".vicode.json"),
      JSON.stringify({
        apiKey: "test-key",
        model: "anthropic/claude-sonnet-4",
        systemPrompt: "Be helpful",
      })
    )
    const result = loadConfig({ projectPath: tmpDir })
    expect(result.apiKey).toBe("test-key")
    expect(result.model).toBe("anthropic/claude-sonnet-4")
    expect(result.systemPrompt).toBe("Be helpful")
  })

  it("rejects invalid config with unknown fields", () => {
    writeFileSync(
      join(tmpDir, ".vicode.json"),
      JSON.stringify({ invalidField: true })
    )
    expect(() => loadConfig({ projectPath: tmpDir })).toThrow()
  })
})

describe("config merge priority", () => {
  it("project config overrides global config", () => {
    const homeDir = join(tmpDir, "home")
    mkdirSync(homeDir, { recursive: true })
    writeFileSync(
      join(homeDir, "config.json"),
      JSON.stringify({ model: "global-model", apiKey: "global-key" })
    )
    writeFileSync(
      join(tmpDir, ".vicode.json"),
      JSON.stringify({ model: "project-model" })
    )
    const result = loadConfig({
      projectPath: tmpDir,
      globalConfigPath: join(homeDir, "config.json"),
    })
    expect(result.model).toBe("project-model")
    expect(result.apiKey).toBe("global-key")
  })

  it("CLI flags override project config", () => {
    writeFileSync(
      join(tmpDir, ".vicode.json"),
      JSON.stringify({ model: "project-model" })
    )
    const result = loadConfig({
      projectPath: tmpDir,
      cliArgs: { model: "cli-model" },
    })
    expect(result.model).toBe("cli-model")
  })

  it("CLI flags override global config", () => {
    const homeDir = join(tmpDir, "home")
    mkdirSync(homeDir, { recursive: true })
    writeFileSync(
      join(homeDir, "config.json"),
      JSON.stringify({ model: "global-model" })
    )
    const result = loadConfig({
      projectPath: tmpDir,
      globalConfigPath: join(homeDir, "config.json"),
      cliArgs: { model: "cli-model" },
    })
    expect(result.model).toBe("cli-model")
  })

  it("full three-layer merge", () => {
    const homeDir = join(tmpDir, "home")
    mkdirSync(homeDir, { recursive: true })
    writeFileSync(
      join(homeDir, "config.json"),
      JSON.stringify({ apiKey: "global-key", model: "global-model" })
    )
    writeFileSync(
      join(tmpDir, ".vicode.json"),
      JSON.stringify({ model: "project-model", systemPrompt: "project-prompt" })
    )
    const result = loadConfig({
      projectPath: tmpDir,
      globalConfigPath: join(homeDir, "config.json"),
      cliArgs: { model: "cli-model" },
    })
    expect(result.apiKey).toBe("global-key")
    expect(result.model).toBe("cli-model")
    expect(result.systemPrompt).toBe("project-prompt")
  })
})

describe("API key fallback", () => {
  it("uses OPENROUTER_API_KEY env var when no config key", () => {
    const original = process.env.OPENROUTER_API_KEY
    process.env.OPENROUTER_API_KEY = "env-key"
    try {
      const result = loadConfig({ projectPath: tmpDir })
      expect(result.apiKey).toBe("env-key")
    } finally {
      if (original === undefined) delete process.env.OPENROUTER_API_KEY
      else process.env.OPENROUTER_API_KEY = original
    }
  })

  it("config key takes precedence over env var", () => {
    const original = process.env.OPENROUTER_API_KEY
    process.env.OPENROUTER_API_KEY = "env-key"
    try {
      writeFileSync(
        join(tmpDir, ".vicode.json"),
        JSON.stringify({ apiKey: "config-key" })
      )
      const result = loadConfig({ projectPath: tmpDir })
      expect(result.apiKey).toBe("config-key")
    } finally {
      if (original === undefined) delete process.env.OPENROUTER_API_KEY
      else process.env.OPENROUTER_API_KEY = original
    }
  })
})

describe("missing config files", () => {
  it("does not throw when no config files exist", () => {
    const result = loadConfig({ projectPath: tmpDir })
    expect(result).toBeDefined()
  })

  it("does not throw when global config dir does not exist", () => {
    const result = loadConfig({
      projectPath: tmpDir,
      globalConfigPath: "/nonexistent/path/config.json",
    })
    expect(result).toBeDefined()
  })
})
