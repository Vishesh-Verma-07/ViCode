import { describe, it, expect, beforeEach, afterEach } from "bun:test"
import { join } from "path"
import { mkdirSync, rmSync, existsSync } from "fs"
import { webFetchTool, setWebFetchDeps } from "@/tools/web-fetch"
import type { ToolContext } from "@/core/types"

const tmpDir = join(import.meta.dir, "__tmp_web_fetch_test")
const ctx: ToolContext = { projectPath: tmpDir }

function call(args: Record<string, unknown>) {
  return webFetchTool.execute(args, ctx)
}

let restore: (() => void) | undefined

beforeEach(() => {
  if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true })
  mkdirSync(tmpDir, { recursive: true })
})

afterEach(() => {
  restore?.()
  restore = undefined
  if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true })
})

function useDeps(deps: Parameters<typeof setWebFetchDeps>[0]) {
  restore = setWebFetchDeps(deps)
}

describe("web_fetch", () => {
  it("retrieves http URL and returns readable content", async () => {
    const html = "<html><body><h1>Title</h1><p>Hello World</p></body></html>"
    useDeps({
      fetchImpl: (async () =>
        new Response(html, { status: 200, headers: { "content-type": "text/html" } })) as unknown as typeof fetch,
    })
    const result = await call({ url: "http://example.com" })
    expect(result).toContain("Title")
    expect(result).toContain("Hello World")
  })

  it("accepts https URL", async () => {
    useDeps({
      fetchImpl: (async () =>
        new Response("hello", { status: 200, headers: { "content-type": "text/plain" } })) as unknown as typeof fetch,
    })
    const result = await call({ url: "https://example.com" })
    expect(result).toContain("hello")
  })

  it("refuses file:// URL", async () => {
    let called = false
    useDeps({
      fetchImpl: (async () => {
        called = true
        return new Response("")
      }) as unknown as typeof fetch,
    })
    const result = await call({ url: "file:///etc/passwd" })
    expect(result).toContain("refused")
    expect(result).toContain("file://")
    expect(called).toBe(false)
  })

  it("refuses relative path", async () => {
    let called = false
    useDeps({
      fetchImpl: (async () => {
        called = true
        return new Response("")
      }) as unknown as typeof fetch,
    })
    const result = await call({ url: "./index.html" })
    expect(result).toContain("refused")
    expect(result).not.toContain("Error")
    expect(called).toBe(false)
  })

  it("refuses unparseable URL", async () => {
    let called = false
    useDeps({
      fetchImpl: (async () => {
        called = true
        return new Response("")
      }) as unknown as typeof fetch,
    })
    const result = await call({ url: "not a url" })
    expect(result).toContain("refused")
    expect(called).toBe(false)
  })

  it("refuses malformed string starting with https", async () => {
    let called = false
    useDeps({
      fetchImpl: (async () => {
        called = true
        return new Response("")
      }) as unknown as typeof fetch,
    })
    const result = await call({ url: "https:/bad" })
    expect(result).toContain("refused")
    expect(called).toBe(false)
  })

  it("strips HTML scripts and styles", async () => {
    const html = '<html><head><style>body{color:red}</style><script>alert(1)</script></head><body><p>Content</p></body></html>'
    useDeps({
      fetchImpl: (async () =>
        new Response(html, { status: 200, headers: { "content-type": "text/html" } })) as unknown as typeof fetch,
    })
    const result = await call({ url: "https://example.com" })
    expect(result).toContain("Content")
    expect(result).not.toContain("script")
    expect(result).not.toContain("alert")
    expect(result).not.toContain("color:red")
  })

  it("passes plain text through unmodified", async () => {
    useDeps({
      fetchImpl: (async () =>
        new Response("plain text content", { status: 200, headers: { "content-type": "text/plain" } })) as unknown as typeof fetch,
    })
    const result = await call({ url: "https://example.com" })
    expect(result).toBe("plain text content")
  })

  it("passes JSON through unmodified", async () => {
    const json = '{"key": "value"}'
    useDeps({
      fetchImpl: (async () =>
        new Response(json, { status: 200, headers: { "content-type": "application/json" } })) as unknown as typeof fetch,
    })
    const result = await call({ url: "https://example.com" })
    expect(result).toBe(json)
  })
})

  it("cuts response over byte ceiling with truncation marker", async () => {
    const longContent = "x".repeat(70000)
    useDeps({
      fetchImpl: (async () =>
        new Response(longContent, { status: 200, headers: { "content-type": "text/plain" } })) as unknown as typeof fetch,
    })
    const result = await call({ url: "https://example.com" })
    expect(result).toContain("VICODE_TRUNCATION_SENTINEL")
    expect(result.length).toBeLessThan(longContent.length)
  })

  it("times out and returns timeout message", async () => {
    let called = false
    useDeps({
      timeoutMs: 10,
      fetchImpl: (async (_input: unknown, init?: RequestInit) => {
        called = true
        return new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(new Error("aborted")))
        })
      }) as unknown as typeof fetch,
    })
    const result = await call({ url: "https://example.com/slow" })
    expect(result).toContain("timed out")
    expect(result).not.toContain("Error")
  })

  it("returns status error message for non-success HTTP status", async () => {
    useDeps({
      fetchImpl: (async () =>
        new Response("Not Found", { status: 404, headers: { "content-type": "text/plain" } })) as unknown as typeof fetch,
    })
    const result = await call({ url: "https://example.com/missing" })
    expect(result).toContain("404")
    expect(result).not.toContain("Error")
  })

  it("returns transport failure message", async () => {
    useDeps({
      fetchImpl: (async () => {
        throw new Error("network down")
      }) as unknown as typeof fetch,
    })
    const result = await call({ url: "https://example.com/bad" })
    expect(result).toContain("could not fetch")
    expect(result).toContain("network down")
    expect(result).not.toContain("Error")
  })
