import { describe, it, expect, beforeEach, afterEach } from "bun:test"
import { loadConfig, saveApiKeyToGlobalConfig, removeApiKeyFromGlobalConfig } from "@/config/config"
import { mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from "fs"
import { join } from "path"

const tmpDir = join(import.meta.dir, "__tmp_config_test")

let savedApiKey: string | undefined

beforeEach(() => {
  if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true })
  mkdirSync(tmpDir, { recursive: true })
  savedApiKey = process.env.OPENROUTER_API_KEY
  delete process.env.OPENROUTER_API_KEY
})

afterEach(() => {
  if (savedApiKey === undefined) delete process.env.OPENROUTER_API_KEY
  else process.env.OPENROUTER_API_KEY = savedApiKey
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

  it("full two-layer merge: project overrides global", () => {
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
    })
    expect(result.apiKey).toBe("global-key")
    expect(result.model).toBe("project-model")
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

describe("saveApiKeyToGlobalConfig", () => {
  function globalConfigPath(): string {
    return join(tmpDir, "vicode-home", "config.json")
  }

  function makeHome(): void {
    mkdirSync(join(tmpDir, "vicode-home"), { recursive: true })
  }

  it("creates the global config file with the key when none exists", () => {
    makeHome()
    const result = saveApiKeyToGlobalConfig("sk-or-v1-newkey", globalConfigPath())
    expect(result).toBe(true)
    expect(JSON.parse(readFileSync(globalConfigPath(), "utf-8"))).toEqual({ apiKey: "sk-or-v1-newkey" })
  })

  it("merges the key into an existing global config, preserving other fields", () => {
    makeHome()
    writeFileSync(globalConfigPath(), JSON.stringify({ model: "keep-me", apiKey: "old-key" }))
    saveApiKeyToGlobalConfig("new-key", globalConfigPath())
    const saved = JSON.parse(readFileSync(globalConfigPath(), "utf-8"))
    expect(saved.apiKey).toBe("new-key")
    expect(saved.model).toBe("keep-me")
  })

  it("creates the config directory if it does not exist", () => {
    const path = globalConfigPath()
    expect(existsSync(join(tmpDir, "vicode-home"))).toBe(false)
    const result = saveApiKeyToGlobalConfig("sk-or-v1-newkey", path)
    expect(result).toBe(true)
    expect(existsSync(join(tmpDir, "vicode-home"))).toBe(true)
    expect(JSON.parse(readFileSync(path, "utf-8")).apiKey).toBe("sk-or-v1-newkey")
  })

  it("the saved key is picked up by loadConfig as the global layer", () => {
    makeHome()
    const path = globalConfigPath()
    saveApiKeyToGlobalConfig("sk-or-v1-global", path)
    const result = loadConfig({ projectPath: tmpDir, globalConfigPath: path })
    expect(result.apiKey).toBe("sk-or-v1-global")
  })
})

describe("removeApiKeyFromGlobalConfig", () => {
  function globalPath(): string {
    return join(tmpDir, "vicode-home", "config.json")
  }

  it("removes only the apiKey field, preserving other settings", () => {
    mkdirSync(join(tmpDir, "vicode-home"), { recursive: true })
    writeFileSync(globalPath(), JSON.stringify({ apiKey: "sk-or-v1-old", model: "keep-me" }))
    const result = removeApiKeyFromGlobalConfig(globalPath())
    expect(result).toBe(true)
    expect(JSON.parse(readFileSync(globalPath(), "utf-8"))).toEqual({ model: "keep-me" })
  })

  it("returns false and leaves the file untouched when the config has no apiKey", () => {
    mkdirSync(join(tmpDir, "vicode-home"), { recursive: true })
    writeFileSync(globalPath(), JSON.stringify({ model: "keep-me" }))
    expect(removeApiKeyFromGlobalConfig(globalPath())).toBe(false)
    expect(JSON.parse(readFileSync(globalPath(), "utf-8"))).toEqual({ model: "keep-me" })
  })

  it("returns false when the config file does not exist", () => {
    expect(removeApiKeyFromGlobalConfig(join(tmpDir, "vicode-home", "config.json"))).toBe(false)
  })

  it("cleared config no longer yields an apiKey via loadConfig", () => {
    mkdirSync(join(tmpDir, "vicode-home"), { recursive: true })
    saveApiKeyToGlobalConfig("sk-or-v1-global", globalPath())
    expect(removeApiKeyFromGlobalConfig(globalPath())).toBe(true)
    const result = loadConfig({ projectPath: tmpDir, globalConfigPath: globalPath() })
    expect(result.apiKey).toBeUndefined()
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

describe("sensitiveFiles config", () => {
  function makeHomeDir(): string {
    const homeDir = join(tmpDir, "home")
    mkdirSync(homeDir, { recursive: true })
    return homeDir
  }

  it("accepts sensitiveFiles in project config", () => {
    writeFileSync(
      join(tmpDir, ".vicode.json"),
      JSON.stringify({ sensitiveFiles: ["service-account.json", "secrets/**"] }),
    )
    const result = loadConfig({ projectPath: tmpDir })
    expect(result.sensitiveFiles).toEqual(["service-account.json", "secrets/**"])
  })

  it("merges global and project sensitiveFiles instead of overriding", () => {
    const homeDir = makeHomeDir()
    writeFileSync(
      join(homeDir, "config.json"),
      JSON.stringify({ sensitiveFiles: ["global-secret.txt"] }),
    )
    writeFileSync(
      join(tmpDir, ".vicode.json"),
      JSON.stringify({ sensitiveFiles: ["project-secret.txt"] }),
    )
    const result = loadConfig({ projectPath: tmpDir, globalConfigPath: join(homeDir, "config.json") })
    expect(result.sensitiveFiles).toEqual(["global-secret.txt", "project-secret.txt"])
  })

  it("falls back to global patterns when project has none", () => {
    const homeDir = makeHomeDir()
    writeFileSync(
      join(homeDir, "config.json"),
      JSON.stringify({ sensitiveFiles: ["global-secret.txt"] }),
    )
    const result = loadConfig({ projectPath: tmpDir, globalConfigPath: join(homeDir, "config.json") })
    expect(result.sensitiveFiles).toEqual(["global-secret.txt"])
  })

  it("is absent when no config declares it", () => {
    const result = loadConfig({ projectPath: tmpDir })
    expect(result.sensitiveFiles).toBeUndefined()
  })
})