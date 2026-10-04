import { describe, it, expect, beforeEach, afterEach } from "bun:test"
import {
  loadConfig,
  keyForProvider,
  saveApiKeyToGlobalConfig,
  removeApiKeyFromGlobalConfig,
} from "@/config/config"
import { QUALIFIED_MODEL_FORMAT_VERSION } from "@/core/model-id"
import { PROVIDER_IDS, providerEnvVars } from "@/core/providers"
import { mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from "fs"
import { join } from "path"

const tmpDir = join(import.meta.dir, "__tmp_config_test")

/**
 * Every variable `keyForProvider` reads, derived from the registry so a
 * developer's own exported key cannot leak into these tests — the namespaced
 * names included, since setting one is now a supported thing to do.
 */
const PROVIDER_ENV_VARS = [...new Set(PROVIDER_IDS.flatMap(providerEnvVars))]

let savedEnv: Record<string, string | undefined> = {}
let savedHome: string | undefined
let savedUserProfile: string | undefined

beforeEach(() => {
  if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true })
  mkdirSync(tmpDir, { recursive: true })
  savedEnv = {}
  for (const name of PROVIDER_ENV_VARS) {
    savedEnv[name] = process.env[name]
    delete process.env[name]
  }
  // Point home at the temp dir so tests that omit `globalConfigPath` cannot
  // read the developer's real ~/.vicode/config.json.
  savedHome = process.env.HOME
  savedUserProfile = process.env.USERPROFILE
  process.env.HOME = join(tmpDir, "home")
  process.env.USERPROFILE = join(tmpDir, "home")
})

afterEach(() => {
  for (const name of PROVIDER_ENV_VARS) {
    const saved = savedEnv[name]
    if (saved === undefined) delete process.env[name]
    else process.env[name] = saved
  }
  if (savedHome === undefined) delete process.env.HOME
  else process.env.HOME = savedHome
  if (savedUserProfile === undefined) delete process.env.USERPROFILE
  else process.env.USERPROFILE = savedUserProfile
  if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true })
})

describe("config schema", () => {
  it("accepts empty config", () => {
    const result = loadConfig({ projectPath: tmpDir, globalConfigPath: join(tmpDir, "global.json") })
    expect(result.apiKeys).toEqual({})
    expect(result.model).toBeUndefined()
  })

  it("accepts valid config with all fields", () => {
    writeFileSync(
      join(tmpDir, ".vicode.json"),
      JSON.stringify({
        apiKeys: { openai: "sk-test", anthropic: "sk-ant-test" },
        model: "anthropic/claude-sonnet-4",
        version: QUALIFIED_MODEL_FORMAT_VERSION,
        systemPrompt: "Be helpful",
      })
    )
    const result = loadConfig({ projectPath: tmpDir })
    expect(result.apiKeys).toEqual({ openai: "sk-test", anthropic: "sk-ant-test" })
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
      JSON.stringify({ model: "global-model", apiKeys: { openrouter: "global-key" } })
    )
    writeFileSync(
      join(tmpDir, ".vicode.json"),
      JSON.stringify({ model: "project-model" })
    )
    const result = loadConfig({
      projectPath: tmpDir,
      globalConfigPath: join(homeDir, "config.json"),
    })
    expect(result.model).toBe("openrouter/project-model")
    expect(result.apiKeys.openrouter).toBe("global-key")
  })

  it("full two-layer merge: project overrides global", () => {
    const homeDir = join(tmpDir, "home")
    mkdirSync(homeDir, { recursive: true })
    writeFileSync(
      join(homeDir, "config.json"),
      JSON.stringify({ apiKeys: { openrouter: "global-key" }, model: "global-model" })
    )
    writeFileSync(
      join(tmpDir, ".vicode.json"),
      JSON.stringify({ model: "project-model", systemPrompt: "project-prompt" })
    )
    const result = loadConfig({
      projectPath: tmpDir,
      globalConfigPath: join(homeDir, "config.json"),
    })
    expect(result.apiKeys.openrouter).toBe("global-key")
    expect(result.model).toBe("openrouter/project-model")
    expect(result.systemPrompt).toBe("project-prompt")
  })
})

describe("API key fallback", () => {
  it("uses OPENROUTER_API_KEY env var when no config key", () => {
    const original = process.env.OPENROUTER_API_KEY
    process.env.OPENROUTER_API_KEY = "env-key"
    try {
      const config = loadConfig({ projectPath: tmpDir, globalConfigPath: join(tmpDir, "global.json") })
      expect(keyForProvider(config, "openrouter")).toBe("env-key")
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
        JSON.stringify({ apiKeys: { openrouter: "config-key" } })
      )
      const config = loadConfig({ projectPath: tmpDir })
      expect(keyForProvider(config, "openrouter")).toBe("config-key")
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
    const result = saveApiKeyToGlobalConfig("openrouter", "sk-or-v1-newkey", globalConfigPath())
    expect(result).toBe(true)
    expect(JSON.parse(readFileSync(globalConfigPath(), "utf-8"))).toEqual({
      apiKeys: { openrouter: "sk-or-v1-newkey" },
    })
  })

  it("merges the key into an existing global config, preserving other fields", () => {
    makeHome()
    writeFileSync(globalConfigPath(), JSON.stringify({ model: "keep-me", apiKeys: { openrouter: "old-key" } }))
    saveApiKeyToGlobalConfig("openrouter", "new-key", globalConfigPath())
    const saved = JSON.parse(readFileSync(globalConfigPath(), "utf-8"))
    expect(saved.apiKeys.openrouter).toBe("new-key")
    expect(saved.model).toBe("keep-me")
  })

  it("creates the config directory if it does not exist", () => {
    const path = globalConfigPath()
    expect(existsSync(join(tmpDir, "vicode-home"))).toBe(false)
    const result = saveApiKeyToGlobalConfig("openrouter", "sk-or-v1-newkey", path)
    expect(result).toBe(true)
    expect(existsSync(join(tmpDir, "vicode-home"))).toBe(true)
    expect(JSON.parse(readFileSync(path, "utf-8")).apiKeys.openrouter).toBe("sk-or-v1-newkey")
  })

  it("the saved key is picked up by loadConfig as the global layer", () => {
    makeHome()
    const path = globalConfigPath()
    saveApiKeyToGlobalConfig("openrouter", "sk-or-v1-global", path)
    const config = loadConfig({ projectPath: tmpDir, globalConfigPath: path })
    expect(keyForProvider(config, "openrouter")).toBe("sk-or-v1-global")
  })
})

describe("removeApiKeyFromGlobalConfig", () => {
  function globalPath(): string {
    return join(tmpDir, "vicode-home", "config.json")
  }

  it("removes only that Provider's key, preserving other settings", () => {
    mkdirSync(join(tmpDir, "vicode-home"), { recursive: true })
    writeFileSync(globalPath(), JSON.stringify({ apiKeys: { openrouter: "sk-or-v1-old" }, model: "keep-me" }))
    const result = removeApiKeyFromGlobalConfig("openrouter", globalPath())
    expect(result).toBe(true)
    expect(JSON.parse(readFileSync(globalPath(), "utf-8"))).toEqual({ model: "keep-me" })
  })

  it("leaves other Providers' keys alone", () => {
    mkdirSync(join(tmpDir, "vicode-home"), { recursive: true })
    writeFileSync(globalPath(), JSON.stringify({ apiKeys: { openrouter: "sk-or-v1-old", openai: "sk-openai" } }))
    expect(removeApiKeyFromGlobalConfig("openrouter", globalPath())).toBe(true)
    expect(JSON.parse(readFileSync(globalPath(), "utf-8")).apiKeys).toEqual({ openai: "sk-openai" })
  })

  it("returns false and leaves the file untouched when the config has no such key", () => {
    mkdirSync(join(tmpDir, "vicode-home"), { recursive: true })
    writeFileSync(globalPath(), JSON.stringify({ model: "keep-me" }))
    expect(removeApiKeyFromGlobalConfig("openrouter", globalPath())).toBe(false)
    expect(JSON.parse(readFileSync(globalPath(), "utf-8"))).toEqual({ model: "keep-me" })
  })

  it("returns false when the config file does not exist", () => {
    expect(removeApiKeyFromGlobalConfig("openrouter", join(tmpDir, "vicode-home", "config.json"))).toBe(false)
  })

  it("cleared config no longer yields a key via loadConfig", () => {
    mkdirSync(join(tmpDir, "vicode-home"), { recursive: true })
    saveApiKeyToGlobalConfig("openrouter", "sk-or-v1-global", globalPath())
    expect(removeApiKeyFromGlobalConfig("openrouter", globalPath())).toBe(true)
    const config = loadConfig({ projectPath: tmpDir, globalConfigPath: globalPath() })
    expect(keyForProvider(config, "openrouter")).toBeUndefined()
  })
})

describe("model id qualification", () => {
  it("keeps a pre-qualification config model on OpenRouter", () => {
    // No version marker, so this predates multi-provider support: the id can
    // only have meant OpenRouter, even though it reads as the OpenAI Provider.
    writeFileSync(
      join(tmpDir, ".vicode.json"),
      JSON.stringify({ model: "openai/gpt-4o" }),
    )
    expect(loadConfig({ projectPath: tmpDir }).model).toBe("openrouter/openai/gpt-4o")
  })

  it("keeps a pre-qualification Anthropic id on OpenRouter", () => {
    writeFileSync(
      join(tmpDir, ".vicode.json"),
      JSON.stringify({ model: "anthropic/claude-sonnet-4" }),
    )
    expect(loadConfig({ projectPath: tmpDir }).model).toBe(
      "openrouter/anthropic/claude-sonnet-4",
    )
  })

  it("reads a versioned config model as the Provider it names", () => {
    writeFileSync(
      join(tmpDir, ".vicode.json"),
      JSON.stringify({ version: QUALIFIED_MODEL_FORMAT_VERSION, model: "anthropic/claude-opus-5-5" }),
    )
    expect(loadConfig({ projectPath: tmpDir }).model).toBe("anthropic/claude-opus-5-5")
  })

  it("applies the version of the layer the model came from", () => {
    const homeDir = join(tmpDir, "home4")
    mkdirSync(homeDir, { recursive: true })
    // The global layer is current-format, so its OpenAI id means OpenAI...
    writeFileSync(
      join(homeDir, "config.json"),
      JSON.stringify({
        version: QUALIFIED_MODEL_FORMAT_VERSION,
        model: "openai/gpt-4o",
        apiKeys: { openai: "sk-global" },
      }),
    )
    // ...and it is not overridden, so the current-format reading stands.
    const config = loadConfig({
      projectPath: tmpDir,
      globalConfigPath: join(homeDir, "config.json"),
    })
    expect(config.model).toBe("openai/gpt-4o")
  })

  it("falls back to the global model, qualified by the global layer's version", () => {
    const homeDir = join(tmpDir, "home5")
    mkdirSync(homeDir, { recursive: true })
    writeFileSync(
      join(homeDir, "config.json"),
      JSON.stringify({ model: "openai/gpt-4o" }),
    )
    const config = loadConfig({
      projectPath: tmpDir,
      globalConfigPath: join(homeDir, "config.json"),
    })
    expect(config.model).toBe("openrouter/openai/gpt-4o")
  })

  it("leaves an unversioned project's unresolvable model alone", () => {
    writeFileSync(
      join(tmpDir, ".vicode.json"),
      JSON.stringify({ model: "google/gemini-3-pro" }),
    )
    // Legacy data is OpenRouter by definition, so this is not left alone.
    expect(loadConfig({ projectPath: tmpDir }).model).toBe(
      "openrouter/google/gemini-3-pro",
    )
  })

  it("leaves a versioned config's unresolvable model alone", () => {
    writeFileSync(
      join(tmpDir, ".vicode.json"),
      JSON.stringify({
        version: QUALIFIED_MODEL_FORMAT_VERSION,
        model: "google/gemini-3-pro",
      }),
    )
    expect(loadConfig({ projectPath: tmpDir }).model).toBe("google/gemini-3-pro")
  })

  it("leaves model absent when no config declares one", () => {
    expect(loadConfig({ projectPath: tmpDir }).model).toBeUndefined()
  })
})

describe("per-Provider API keys", () => {
  it("reads the legacy top-level apiKey as the OpenRouter key", () => {
    writeFileSync(
      join(tmpDir, ".vicode.json"),
      JSON.stringify({ apiKey: "sk-or-v1-legacy" }),
    )
    const config = loadConfig({ projectPath: tmpDir })
    expect(keyForProvider(config, "openrouter")).toBe("sk-or-v1-legacy")
  })

  it("lets apiKeys[openrouter] win over the legacy apiKey", () => {
    writeFileSync(
      join(tmpDir, ".vicode.json"),
      JSON.stringify({ apiKey: "sk-or-v1-legacy", apiKeys: { openrouter: "sk-or-v1-new" } }),
    )
    const config = loadConfig({ projectPath: tmpDir })
    expect(keyForProvider(config, "openrouter")).toBe("sk-or-v1-new")
  })

  it("keeps each Provider's key independent", () => {
    writeFileSync(
      join(tmpDir, ".vicode.json"),
      JSON.stringify({ apiKeys: { openai: "sk-openai", anthropic: "sk-ant" } }),
    )
    const config = loadConfig({ projectPath: tmpDir })
    expect(keyForProvider(config, "openai")).toBe("sk-openai")
    expect(keyForProvider(config, "anthropic")).toBe("sk-ant")
    expect(keyForProvider(config, "openrouter")).toBeUndefined()
  })

  it("lets a project key override the global key for the same Provider", () => {
    const homeDir = join(tmpDir, "home2")
    mkdirSync(homeDir, { recursive: true })
    writeFileSync(join(homeDir, "config.json"), JSON.stringify({ apiKeys: { openai: "global-openai" } }))
    writeFileSync(join(tmpDir, ".vicode.json"), JSON.stringify({ apiKeys: { openai: "project-openai" } }))
    const config = loadConfig({ projectPath: tmpDir, globalConfigPath: join(homeDir, "config.json") })
    expect(keyForProvider(config, "openai")).toBe("project-openai")
  })

  it("adds a project key for a Provider the global config never mentioned", () => {
    const homeDir = join(tmpDir, "home3")
    mkdirSync(homeDir, { recursive: true })
    writeFileSync(join(homeDir, "config.json"), JSON.stringify({ apiKeys: { openai: "global-openai" } }))
    writeFileSync(join(tmpDir, ".vicode.json"), JSON.stringify({ apiKeys: { anthropic: "project-ant" } }))
    const config = loadConfig({ projectPath: tmpDir, globalConfigPath: join(homeDir, "config.json") })
    expect(keyForProvider(config, "openai")).toBe("global-openai")
    expect(keyForProvider(config, "anthropic")).toBe("project-ant")
  })

  it("drops keys for Providers that are not in the registry", () => {
    writeFileSync(
      join(tmpDir, ".vicode.json"),
      JSON.stringify({ apiKeys: { "not-a-provider": "nope", openai: "sk-openai" } }),
    )
    const config = loadConfig({ projectPath: tmpDir })
    expect(config.apiKeys).toEqual({ openai: "sk-openai" })
  })
})

describe("OPENCODE_API_KEY fallback", () => {
  it("authenticates both Zen and Go", () => {
    process.env.OPENCODE_API_KEY = "sk-opencode"
    const config = loadConfig({ projectPath: tmpDir })
    expect(keyForProvider(config, "opencode")).toBe("sk-opencode")
    expect(keyForProvider(config, "opencode-go")).toBe("sk-opencode")
  })

  it("does not leak to OpenAI or Anthropic", () => {
    process.env.OPENCODE_API_KEY = "sk-opencode"
    const config = loadConfig({ projectPath: tmpDir })
    expect(keyForProvider(config, "openai")).toBeUndefined()
    expect(keyForProvider(config, "anthropic")).toBeUndefined()
  })

  it("uses the per-Provider env var", () => {
    process.env.OPENAI_API_KEY = "sk-env-openai"
    process.env.ANTHROPIC_API_KEY = "sk-env-ant"
    const config = loadConfig({ projectPath: tmpDir })
    expect(keyForProvider(config, "openai")).toBe("sk-env-openai")
    expect(keyForProvider(config, "anthropic")).toBe("sk-env-ant")
  })

  it("prefers a configured key over the env var", () => {
    process.env.OPENAI_API_KEY = "sk-env-openai"
    writeFileSync(
      join(tmpDir, ".vicode.json"),
      JSON.stringify({ apiKeys: { openai: "sk-config-openai" } }),
    )
    const config = loadConfig({ projectPath: tmpDir })
    expect(keyForProvider(config, "openai")).toBe("sk-config-openai")
  })
})

describe("namespaced API key variable", () => {
  it("overrides a Provider's own variable exported for other tooling", () => {
    process.env.OPENAI_API_KEY = "sk-other-tooling"
    process.env.VICODE_OPENAI_API_KEY = "sk-vicode-ci"
    const config = loadConfig({ projectPath: tmpDir })
    expect(keyForProvider(config, "openai")).toBe("sk-vicode-ci")
  })

  it("reads the Provider's own variable when no namespaced one is set", () => {
    process.env.OPENAI_API_KEY = "sk-shared"
    const config = loadConfig({ projectPath: tmpDir })
    expect(keyForProvider(config, "openai")).toBe("sk-shared")
  })

  it("leaves the Provider's own variable in place, only reading around it", () => {
    process.env.OPENAI_API_KEY = "sk-shared"
    process.env.VICODE_OPENAI_API_KEY = "sk-vicode-ci"
    const config = loadConfig({ projectPath: tmpDir })
    expect(keyForProvider(config, "openai")).toBe("sk-vicode-ci")
    expect(process.env.OPENAI_API_KEY).toBe("sk-shared")
  })

  it("keeps the legacy OPENROUTER_API_KEY working on the OpenRouter route", () => {
    process.env.OPENROUTER_API_KEY = "sk-or-legacy"
    const config = loadConfig({ projectPath: tmpDir })
    expect(keyForProvider(config, "openrouter")).toBe("sk-or-legacy")
  })

  it("overrides the legacy name too, for a pipeline that sets both", () => {
    process.env.OPENROUTER_API_KEY = "sk-or-legacy"
    process.env.VICODE_OPENROUTER_API_KEY = "sk-or-namespaced"
    const config = loadConfig({ projectPath: tmpDir })
    expect(keyForProvider(config, "openrouter")).toBe("sk-or-namespaced")
  })

  it("does not stand an OpenRouter key in for another Provider", () => {
    process.env.OPENROUTER_API_KEY = "sk-or-legacy"
    const config = loadConfig({ projectPath: tmpDir })
    expect(keyForProvider(config, "openai")).toBeUndefined()
  })

  it("prefers a configured key over every variable", () => {
    process.env.OPENAI_API_KEY = "sk-shared"
    process.env.VICODE_OPENAI_API_KEY = "sk-vicode-ci"
    writeFileSync(
      join(tmpDir, ".vicode.json"),
      JSON.stringify({ apiKeys: { openai: "sk-config-openai" } }),
    )
    const config = loadConfig({ projectPath: tmpDir })
    expect(keyForProvider(config, "openai")).toBe("sk-config-openai")
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

describe("silentBashCommands config", () => {
  function makeHomeDir(): string {
    const homeDir = join(tmpDir, "home")
    mkdirSync(homeDir, { recursive: true })
    return homeDir
  }

  it("accepts silentBashCommands in project config", () => {
    writeFileSync(
      join(tmpDir, ".vicode.json"),
      JSON.stringify({ silentBashCommands: ["ls", "pwd"] }),
    )
    const result = loadConfig({ projectPath: tmpDir })
    expect(result.silentBashCommands).toEqual(["ls", "pwd"])
  })

  it("merges global and project silentBashCommands instead of overriding", () => {
    const homeDir = makeHomeDir()
    writeFileSync(
      join(homeDir, "config.json"),
      JSON.stringify({ silentBashCommands: ["git status"] }),
    )
    writeFileSync(
      join(tmpDir, ".vicode.json"),
      JSON.stringify({ silentBashCommands: ["npm test"] }),
    )
    const result = loadConfig({ projectPath: tmpDir, globalConfigPath: join(homeDir, "config.json") })
    expect(result.silentBashCommands).toEqual(["git status", "npm test"])
  })

  it("falls back to global list when project has none", () => {
    const homeDir = makeHomeDir()
    writeFileSync(
      join(homeDir, "config.json"),
      JSON.stringify({ silentBashCommands: ["git status"] }),
    )
    const result = loadConfig({ projectPath: tmpDir, globalConfigPath: join(homeDir, "config.json") })
    expect(result.silentBashCommands).toEqual(["git status"])
  })

  it("falls back to project list when global has none", () => {
    const homeDir = makeHomeDir()
    writeFileSync(
      join(homeDir, "config.json"),
      JSON.stringify({ model: "global-model" }),
    )
    writeFileSync(
      join(tmpDir, ".vicode.json"),
      JSON.stringify({ silentBashCommands: ["pwd"] }),
    )
    const result = loadConfig({ projectPath: tmpDir, globalConfigPath: join(homeDir, "config.json") })
    expect(result.silentBashCommands).toEqual(["pwd"])
  })

  it("is absent when no config declares it", () => {
    const result = loadConfig({ projectPath: tmpDir })
    expect(result.silentBashCommands).toBeUndefined()
  })
})