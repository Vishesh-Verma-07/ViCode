import { describe, it, expect, beforeEach, afterEach } from "bun:test"
import { join } from "path"
import { loadConfig, ConfigError, SEARCH_CREDENTIALS_FIELD } from "@/config/config"
import { mkdirSync, writeFileSync, rmSync, existsSync } from "fs"
import {
  searchCredentialFor,
  searchEnvVars,
  missingSearchCredentialMessage,
} from "@/core/search/credential"
import { DEFAULT_SEARCH_BACKEND, getSearchBackend, listSearchBackends } from "@/core/search"
import { SEARCH_BACKEND_IDS, type SearchBackendId } from "@/core/search/types"
import { PROVIDER_IDS, isProviderId, getProvider } from "@/core/providers"

const tmpDir = join(import.meta.dir, "__tmp_search_credential_test")

const backend = getSearchBackend(DEFAULT_SEARCH_BACKEND)
const [NAMESPACED, NATIVE] = searchEnvVars(backend)

/** Every variable any backend's credential is read from, so none leaks in. */
const SEARCH_ENV_VARS = [...new Set(listSearchBackends().flatMap((b) => searchEnvVars(b)))]

let savedEnv: Record<string, string | undefined> = {}

beforeEach(() => {
  if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true })
  mkdirSync(tmpDir, { recursive: true })
  savedEnv = {}
  for (const name of SEARCH_ENV_VARS) {
    savedEnv[name] = process.env[name]
    delete process.env[name]
  }
  const home = process.env.HOME
  const userProfile = process.env.USERPROFILE
  process.env.HOME = join(tmpDir, "home")
  process.env.USERPROFILE = join(tmpDir, "home")
  savedEnv.HOME = home
  savedEnv.USERPROFILE = userProfile
})

afterEach(() => {
  for (const [name, value] of Object.entries(savedEnv)) {
    if (value === undefined) delete process.env[name]
    else process.env[name] = value
  }
  if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true })
})

function writeGlobalConfig(contents: Record<string, unknown>): string {
  const path = join(tmpDir, "global", "config.json")
  mkdirSync(join(tmpDir, "global"), { recursive: true })
  writeFileSync(path, JSON.stringify(contents), "utf-8")
  return path
}

describe("search credential: Global Config field", () => {
  it("resolves from the Global Config when set there", () => {
    const globalConfigPath = writeGlobalConfig({
      [SEARCH_CREDENTIALS_FIELD]: { [DEFAULT_SEARCH_BACKEND]: "brave-from-config" },
    })
    const config = loadConfig({ projectPath: tmpDir, globalConfigPath })
    expect(config.searchApiKeys).toEqual({ brave: "brave-from-config" })
    expect(searchCredentialFor(config)).toBe("brave-from-config")
  })

  it("has its own field and never travels through the Provider key map", () => {
    const globalConfigPath = writeGlobalConfig({
      [SEARCH_CREDENTIALS_FIELD]: { [DEFAULT_SEARCH_BACKEND]: "brave-key" },
    })
    const config = loadConfig({ projectPath: tmpDir, globalConfigPath })
    expect(Object.keys(config.apiKeys)).toEqual([])
    expect(searchCredentialFor(config)).toBe("brave-key")
  })

  it("is absent when no config declares one", () => {
    expect(loadConfig({ projectPath: tmpDir }).searchApiKeys).toBeUndefined()
    expect(searchCredentialFor(loadConfig({ projectPath: tmpDir }))).toBeUndefined()
  })

  it("leaves the Provider keys alone when both are configured", () => {
    const globalConfigPath = writeGlobalConfig({
      apiKeys: { openai: "sk-openai" },
      [SEARCH_CREDENTIALS_FIELD]: { [DEFAULT_SEARCH_BACKEND]: "brave-key" },
    })
    const config = loadConfig({ projectPath: tmpDir, globalConfigPath })
    expect(config.apiKeys).toEqual({ openai: "sk-openai" })
    expect(config.searchApiKeys).toEqual({ brave: "brave-key" })
  })
})

describe("search credential: one per backend", () => {
  it("resolves each backend's own credential, so naming one does not overwrite the other", () => {
    const globalConfigPath = writeGlobalConfig({
      [SEARCH_CREDENTIALS_FIELD]: { brave: "brave-key", serper: "serper-key" },
    })
    const config = loadConfig({ projectPath: tmpDir, globalConfigPath })
    expect(searchCredentialFor(config, getSearchBackend("brave"))).toBe("brave-key")
    expect(searchCredentialFor(config, getSearchBackend("serper"))).toBe("serper-key")
  })

  it("does not hand one backend the other's credential when only one is set", () => {
    const globalConfigPath = writeGlobalConfig({
      [SEARCH_CREDENTIALS_FIELD]: { brave: "brave-key" },
    })
    const config = loadConfig({ projectPath: tmpDir, globalConfigPath })
    expect(searchCredentialFor(config, getSearchBackend("brave"))).toBe("brave-key")
    expect(searchCredentialFor(config, getSearchBackend("serper"))).toBeUndefined()
  })

  it("resolves each backend's credential from that backend's own variables", () => {
    process.env.SERPER_API_KEY = "serper-native"
    process.env.VICODE_SERPER_API_KEY = "serper-namespaced"
    process.env[NATIVE] = "brave-native"
    const config = loadConfig({ projectPath: tmpDir })
    expect(searchCredentialFor(config, getSearchBackend("serper"))).toBe("serper-namespaced")
    expect(searchCredentialFor(config, getSearchBackend("brave"))).toBe("brave-native")
  })
})

describe("search credential: Project Config refusal", () => {
  it("refuses a search credential written into a Project Config, by name", () => {
    // A credential in a file meant to be committed is a leaked one, whatever the
    // loader would otherwise do with it, so it is named rather than read.
    writeFileSync(
      join(tmpDir, ".vicode.json"),
      JSON.stringify({ [SEARCH_CREDENTIALS_FIELD]: { [DEFAULT_SEARCH_BACKEND]: "leaked" } }),
    )
    expect(() => loadConfig({ projectPath: tmpDir, globalConfigPath: writeGlobalConfig({}) })).toThrow(
      new RegExp(SEARCH_CREDENTIALS_FIELD),
    )
  })

  it("names the refusal as a credential, so the advice is the credential one", () => {
    writeFileSync(
      join(tmpDir, ".vicode.json"),
      JSON.stringify({ [SEARCH_CREDENTIALS_FIELD]: { [DEFAULT_SEARCH_BACKEND]: "leaked" } }),
    )
    try {
      loadConfig({ projectPath: tmpDir, globalConfigPath: writeGlobalConfig({}) })
      throw new Error("expected the project config to be refused")
    } catch (error) {
      expect(error).toBeInstanceOf(ConfigError)
      expect((error as ConfigError).refusesApiKey).toBe(true)
      expect((error as ConfigError).refusedCredentialFields).toEqual([SEARCH_CREDENTIALS_FIELD])
      expect((error as ConfigError).path).toBe(join(tmpDir, ".vicode.json"))
    }
  })

  it("does not claim a credential was the problem for any other unknown field", () => {
    writeFileSync(join(tmpDir, ".vicode.json"), JSON.stringify({ searchKey: "x" }))
    try {
      loadConfig({ projectPath: tmpDir, globalConfigPath: writeGlobalConfig({}) })
      throw new Error("expected the project config to be refused")
    } catch (error) {
      expect((error as ConfigError).refusesApiKey).toBe(false)
      expect((error as ConfigError).message).toContain("searchKey")
    }
  })
})

describe("search credential: Namespaced API Key rule", () => {
  it("derives the namespaced name from the backend's own, so they cannot drift", () => {
    expect(NAMESPACED).toBe(`VICODE_${NATIVE}`)
    expect(NAMESPACED).not.toBe(NATIVE)
    for (const candidate of listSearchBackends()) {
      const [namespaced, native] = searchEnvVars(candidate)
      expect(namespaced).toBe(`VICODE_${native}`)
    }
  })

  it("reads the namespaced variable ahead of the backend's native one", () => {
    process.env[NATIVE] = "brave-native"
    process.env[NAMESPACED] = "brave-namespaced"
    const config = loadConfig({ projectPath: tmpDir })
    expect(searchCredentialFor(config)).toBe("brave-namespaced")
  })

  it("authenticates on the backend's native variable alone", () => {
    process.env[NATIVE] = "brave-native"
    const config = loadConfig({ projectPath: tmpDir })
    expect(searchCredentialFor(config)).toBe("brave-native")
  })

  it("leaves the native variable in place, only reading around it", () => {
    process.env[NATIVE] = "brave-native"
    process.env[NAMESPACED] = "brave-namespaced"
    searchCredentialFor(loadConfig({ projectPath: tmpDir }))
    expect(process.env[NATIVE]).toBe("brave-native")
  })

  it("prefers a configured credential over every variable", () => {
    process.env[NATIVE] = "brave-native"
    process.env[NAMESPACED] = "brave-namespaced"
    const globalConfigPath = writeGlobalConfig({
      [SEARCH_CREDENTIALS_FIELD]: { [DEFAULT_SEARCH_BACKEND]: "brave-config" },
    })
    const config = loadConfig({ projectPath: tmpDir, globalConfigPath })
    expect(searchCredentialFor(config)).toBe("brave-config")
  })

  it("keeps one backend's configured credential from standing in for another's", () => {
    // The reason the field is a record: a single flat field would send the
    // default backend's key to whichever backend was named next.
    const globalConfigPath = writeGlobalConfig({
      [SEARCH_CREDENTIALS_FIELD]: { brave: "brave-config" },
    })
    const config = loadConfig({ projectPath: tmpDir, globalConfigPath })
    process.env.SERPER_API_KEY = "serper-native"
    expect(searchCredentialFor(config, getSearchBackend("serper"))).toBe("serper-native")
    expect(searchCredentialFor(config, getSearchBackend("brave"))).toBe("brave-config")
  })
})

describe("search credential: never a Provider credential", () => {
  it("is not a Provider id, so the Provider key map could never carry it", () => {
    expect(isProviderId(DEFAULT_SEARCH_BACKEND)).toBe(false)
    expect(PROVIDER_IDS).not.toContain(DEFAULT_SEARCH_BACKEND as never)
  })

  it("drops a search credential written into the Provider key map", () => {
    const globalConfigPath = writeGlobalConfig({
      apiKeys: { brave: "brave-in-the-map", openai: "sk-openai" },
    })
    const config = loadConfig({ projectPath: tmpDir, globalConfigPath })
    expect(config.apiKeys).toEqual({ openai: "sk-openai" })
  })

  it("appears in no Provider's descriptor, so no Provider surface can render it", () => {
    for (const id of PROVIDER_IDS) {
      const descriptor = getProvider(id)
      expect(descriptor.nativeEnv).not.toContain(backend.nativeEnv)
      expect(descriptor.id).not.toBe(DEFAULT_SEARCH_BACKEND)
    }
  })

  it("is not among the backends the Provider picker renders, which lists Providers", () => {
    // The picker's rows come from the Provider registry alone; a search backend
    // is not in it, so it has no row to be selectable on.
    expect(listSearchBackends().map((b) => b.id)).not.toContain(
      getProvider(PROVIDER_IDS[0]).id,
    )
    expect(PROVIDER_IDS).toHaveLength(5)
  })

  it("is a different name space from a Provider id for every backend that ships", () => {
    for (const id of SEARCH_BACKEND_IDS) {
      expect(isProviderId(id as string)).toBe(false)
      expect(PROVIDER_IDS).not.toContain(id as never)
    }
  })
})

describe("missing search credential message", () => {
  it("names the credential, both variable names, and where to set it", () => {
    const message = missingSearchCredentialMessage(backend)
    expect(message).toContain(SEARCH_CREDENTIALS_FIELD)
    expect(message).toContain(NAMESPACED)
    expect(message).toContain(NATIVE)
    expect(message).toContain("~/.vicode/config.json")
    expect(message).toContain(backend.keyUrl)
  })

  it("says which backend's credential is missing, by id and by label", () => {
    // Two backends means "no credential" is ambiguous unless it names which
    // one is unset — the user may well hold a key for the other.
    const message = missingSearchCredentialMessage(backend)
    expect(message).toContain(`"${DEFAULT_SEARCH_BACKEND}"`)
    expect(message).toContain(backend.label)

    const other = getSearchBackend(SEARCH_BACKEND_IDS.find((id) => id !== DEFAULT_SEARCH_BACKEND)!)
    const otherMessage = missingSearchCredentialMessage(other)
    expect(otherMessage).toContain(`"${other.id}"`)
    expect(otherMessage).toContain(other.label)
    expect(otherMessage).not.toContain(`"${DEFAULT_SEARCH_BACKEND}"`)
  })

  it("shows the record entry for the backend that is missing one", () => {
    const message = missingSearchCredentialMessage(backend)
    expect(message).toContain(`{ "${DEFAULT_SEARCH_BACKEND}": "your-key" }`)
  })

  it("says it is a missing credential, not an empty result", () => {
    const message = missingSearchCredentialMessage(backend)
    expect(message).toMatch(/no search credential is set/)
    expect(message).toMatch(/not an empty result/i)
  })
})
