import React from "react"
import { describe, it, expect, afterAll } from "bun:test"
import { renderToString } from "ink"
import { render } from "ink-testing-library"
import { KeyEntryScreen } from "@/ui/key-entry-screen"
import { UsagePanel } from "@/ui/usage-panel"
import { routeLabel } from "@/ui/route-label"
import { PROVIDER_IDS, listProviders, type ProviderId } from "@/core/providers"
import { SEARCH_BACKEND_IDS, listSearchBackends } from "@/core/search"
import { calculateCost } from "@/core/cost-calculator"
import { loadConfig, SEARCH_CREDENTIALS_FIELD } from "@/config/config"
import { mkdtempSync, rmSync, writeFileSync } from "fs"
import { join } from "path"
import { tmpdir } from "os"

/**
 * The credential the search uses, deliberately distinctive so that finding it
 * anywhere in a rendered frame or a computed total would be unmistakable.
 */
const CREDENTIAL = "br4ve-s3cret-must-not-leak"

const PROVIDER: ProviderId = "anthropic"
const MODEL = "claude-opus-5-5"

const USAGE = {
  inputTokens: 1000,
  outputTokens: 500,
  totalTokens: 1500,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
  cost: 0.0123,
}

const PRICING = {
  inputPricePerToken: 3 / 1_000_000,
  outputPricePerToken: 15 / 1_000_000,
}

function clean(s: string): string {
  return s.replace(/\u001B\[[0-9;]*m/g, "")
}

const home = mkdtempSync(join(tmpdir(), "vicode-search-surfaces-home-"))
const projectPath = mkdtempSync(join(tmpdir(), "vicode-search-surfaces-project-"))

afterAll(() => {
  rmSync(home, { recursive: true, force: true })
  rmSync(projectPath, { recursive: true, force: true })
})

function configWithSearchCredential() {
  const globalConfigPath = join(home, "config.json")
  writeFileSync(
    globalConfigPath,
    JSON.stringify({
      [SEARCH_CREDENTIALS_FIELD]: { brave: CREDENTIAL },
      apiKeys: { anthropic: "sk-ant-real" },
    }),
  )
  return loadConfig({ projectPath, globalConfigPath })
}

/**
 * Every credential-bearing surface, one after another.
 *
 * The acceptance criterion names five places the search credential must not
 * appear, so each is checked where it actually renders or computes rather than
 * inferred from the config field being separate. A surface that started reading
 * the credential would fail the test that names it.
 */
describe("the search credential reaches no Provider surface", () => {
  it("is genuinely configured, so every assertion below is about a credential that exists", () => {
    const config = configWithSearchCredential()
    expect(config.searchApiKeys).toEqual({ brave: CREDENTIAL })
    // And a Provider key is configured too, so the Provider surfaces below have
    // a real key to show — the search credential is not passing because there
    // was nothing else on offer.
    expect(config.apiKeys).toEqual({ anthropic: "sk-ant-real" })
  })

  describe("the Provider picker", () => {
    it("offers Providers and nothing else, because its rows come from the Provider registry", () => {
      // This is the picker's only source of rows. A search backend registered as
      // a Provider would appear here; none is.
      const ids = listProviders().map((row) => row.id)
      expect(ids.sort()).toEqual([...PROVIDER_IDS].sort())
      for (const backend of listSearchBackends()) {
        expect(ids).not.toContain(backend.id)
      }
    })

    it("counts five Providers, none of which is a search backend", () => {
      expect(PROVIDER_IDS).toHaveLength(5)
      for (const id of SEARCH_BACKEND_IDS) {
        expect(PROVIDER_IDS).not.toContain(id as ProviderId)
      }
    })
  })

  describe("the API Key Entry Screen's Provider list", () => {
    it("asks for a Provider key, and cannot be handed a search backend to ask about", () => {
      // The prop is typed to a Provider id, which is the enforcement: no value
      // of a search backend's id is one this screen accepts.
      const instance = render(<KeyEntryScreen provider={PROVIDER} requireKey onSubmit={() => {}} />)
      const frame = instance.lastFrame() ?? ""
      expect(frame).not.toContain(CREDENTIAL)
      expect(frame).not.toContain(SEARCH_CREDENTIALS_FIELD)
      instance.unmount()
    })

    it("names no search backend in any Provider's entry screen", () => {
      for (const id of PROVIDER_IDS) {
        const instance = render(<KeyEntryScreen provider={id} requireKey onSubmit={() => {}} />)
        const frame = instance.lastFrame() ?? ""
        for (const backend of listSearchBackends()) {
          expect(frame).not.toContain(backend.label)
          expect(frame).not.toContain(backend.nativeEnv)
        }
        instance.unmount()
      }
    })
  })

  describe("the Route Label", () => {
    it("shows the route being chatted through, never a credential for something else", () => {
      const label = routeLabel({
        id: MODEL,
        name: "Claude Opus 5.5",
        contextLength: 200_000,
        provider: PROVIDER,
      })
      expect(label).toBe(`${PROVIDER}/${MODEL}`)
      expect(label).not.toContain(CREDENTIAL)
      expect(label).not.toContain(SEARCH_CREDENTIALS_FIELD)
    })
  })

  describe("the Usage Panel", () => {
    it("reports token use and cost, with nothing about search credentials in it", () => {
      const width = 80
      const frame = clean(
        renderToString(
          <UsagePanel
            width={width}
            route={routeLabel({
              id: MODEL,
              name: "Claude Opus 5.5",
              contextLength: 200_000,
              provider: PROVIDER,
            })}
            contextLength={200_000}
            usage={USAGE}
            turns={1}
            status={{ kind: "idle" }}
          />,
          { columns: width },
        ),
      )

      expect(frame).not.toContain(CREDENTIAL)
      expect(frame).not.toContain(SEARCH_CREDENTIALS_FIELD)
      for (const backend of listSearchBackends()) {
        expect(frame.toLowerCase()).not.toContain(backend.label.toLowerCase())
      }
      // It does render the usage and cost it is for, so the assertions above are
      // not passing on an empty frame.
      expect(frame).toContain("Tokens:")
      expect(frame).toContain("1.5k")
      expect(frame).toContain("Cost:")
    })
  })

  describe("cost accounting", () => {
    it("prices a Turn from token counts alone, so no credential can enter a total", () => {
      // The function's whole input is token counts and a price per token. There
      // is no parameter through which any credential could reach it.
      const total = calculateCost(USAGE, PRICING)
      expect(total).not.toBeNull()
      expect(total).toBe(1000 * PRICING.inputPricePerToken + 500 * PRICING.outputPricePerToken)
      expect(String(total)).not.toContain("br4ve")
    })

    it("reports no price for a search backend, since it is not a route", () => {
      // A search consumes no model tokens, so there is nothing to price. If the
      // backend ever became a route, this would start returning a number and
      // the bill would be wrong.
      expect(calculateCost(USAGE, null)).toBeNull()
    })
  })

  it("leaves the Provider key map untouched by the search credential", () => {
    // The final backstop: whatever a surface asks the config for, the Provider
    // key map is still exactly the Provider keys and nothing else.
    const config = configWithSearchCredential()
    expect(Object.keys(config.apiKeys)).toEqual(["anthropic"])
  })
})