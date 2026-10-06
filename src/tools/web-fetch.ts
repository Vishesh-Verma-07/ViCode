/**
 * `web_fetch`: the agent can retrieve a web page and hand back prose the model
 * can actually read.
 *
 * The Tool treats the URL as untrusted input: only `http` and `https` are
 * honoured, and validation reads the parsed URL rather than matching a string
 * prefix. A refused URL produces no outbound request at all. Failures are
 * distinguishable (refused URL, timeout, non-success HTTP status, transport
 * failure) so the model can choose how to act.
 */
import { z } from "zod"
import type { ToolDefinition, ToolContext } from "../core/types"
import { HttpError, httpRequestText, DEFAULT_HTTP_TIMEOUT_MS, DEFAULT_HTTP_MAX_BYTES } from "../core/http"
import { capResult, MAX_TOOL_RESULT_BYTES } from "../core/cap-result"

const DEFAULT_FETCH_TIMEOUT_MS = DEFAULT_HTTP_TIMEOUT_MS
const DEFAULT_FETCH_MAX_BYTES = DEFAULT_HTTP_MAX_BYTES

function parseUrlOrNull(input: string): URL | null {
  try {
    const trimmed = input.trim()
    // Reject strings that don't look like absolute URLs with protocol
    if (!/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(trimmed)) {
      return null
    }
    // Reject malformed cases like https:/bad (missing second slash)
    if ((trimmed.startsWith("https:/") && !trimmed.startsWith("https://")) ||
        (trimmed.startsWith("http:/") && !trimmed.startsWith("http://"))) {
      return null
    }
    const url = new URL(trimmed)
    if (!url.protocol || !url.hostname || url.hostname === "") {
      return null
    }
    return url
  } catch {
    return null
  }
}

function validateAllowedUrl(url: URL): boolean {
  const protocol = url.protocol.toLowerCase()
  return protocol === "http:" || protocol === "https:"
}

function refusedUrlMessage(urlStr: string): string {
  return [
    `web_fetch refused the URL "${urlStr}".`,
    "Only http and https are accepted. file://, relative paths, and unparseable URLs are not allowed.",
    "No outbound request was made.",
  ].join("\n")
}

function failureMessage(urlStr: string, error: unknown): string {
  const head = `web_fetch could not fetch "${urlStr}". This is a failure, not an absence.`

  if (error instanceof HttpError) {
    switch (error.kind) {
      case "timeout":
        return [
          head,
          `Cause: the request timed out (${error.message}). The host did not answer in time.`,
          "A retry may succeed; the request was never completed.",
        ].join("\n")
      case "status":
        return [
          head,
          `Cause: the server refused the request — ${error.message}.`,
          statusAdvice(error.status),
        ].join("\n")
      case "malformed":
        return [
          head,
          `Cause: the response body could not be read (${error.message}).`,
          "The request completed but the content could not be parsed.",
        ].join("\n")
      case "transport":
        return [
          head,
          `Cause: the network failed (${error.message}).`,
          "This is a connectivity or DNS issue. A retry may succeed.",
        ].join("\n")
    }
  }

  return [head, `Cause: ${error instanceof Error ? error.message : String(error)}`].join("\n")
}

function statusAdvice(status: number | null): string {
  if (status === 401 || status === 403) {
    return "The request was not authorized. Check the URL or credentials if required."
  }
  if (status === 429) {
    return "Rate limit reached. Wait before retrying."
  }
  if (status !== null && status >= 500) {
    return "The server failed. Retrying later may succeed."
  }
  if (status !== null && status >= 400) {
    return "The server rejected the request."
  }
  return "The server refused the request."
}

function stripHtml(html: string): string {
  let result = html.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "")
  result = result.replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, "")
  result = result.replace(/<!--[\s\S]*?-->/g, "")
  result = result.replace(/<\/(p|div|h[1-6]|ul|ol|li|blockquote|tr|td|th|table|pre|article|section|header|footer|nav)\b[^>]*>/gi, "\n\n")
  result = result.replace(/<br\b[^>]*\/?>/gi, "\n")
  result = result.replace(/<[^>]+>/g, " ")
  result = result.replace(/&nbsp;/g, " ")
  result = result.replace(/&amp;/g, "&")
  result = result.replace(/&lt;/g, "<")
  result = result.replace(/&gt;/g, ">")
  result = result.replace(/&quot;/g, '"')
  result = result.replace(/&#39;/g, "'")
  result = result.replace(/&apos;/g, "'")
  result = result.replace(/&ndash;/g, "–")
  result = result.replace(/&mdash;/g, "—")
  result = result.replace(/[ \t]+/g, " ")
  result = result.replace(/\n\s+\n/g, "\n\n")
  result = result.replace(/\n{3,}/g, "\n\n")
  return result.trim()
}

function isPlainTextOrJson(contentType: string | null): boolean {
  if (!contentType) return false
  const lower = contentType.toLowerCase()
  return lower.includes("text/plain") || lower.includes("application/json") || lower.includes("text/json")
}

function isHtml(contentType: string | null): boolean {
  if (!contentType) return false
  const lower = contentType.toLowerCase()
  return lower.includes("text/html") || lower.includes("application/xhtml")
}

export interface WebFetchDeps {
  timeoutMs?: number
  maxBytes?: number
  fetchImpl?: typeof fetch
}

let deps: WebFetchDeps = {}

export function setWebFetchDeps(next: WebFetchDeps): () => void {
  const previous = deps
  deps = next
  return () => {
    deps = previous
  }
}

export const webFetchTool: ToolDefinition = {
  name: "web_fetch",
  description:
    "Fetch a web page and return its readable content. Accepts only http or https URLs. Treats the URL as untrusted input and pauses for user approval before making the request.",
  parameters: z.object({
    url: z.string().describe("The URL to fetch (must be http or https)"),
  }),
  dangerous: false,
  requiresApproval: async (args: Record<string, unknown>, _context: ToolContext) => {
    const urlStr = typeof args.url === "string" ? args.url : ""
    const parsed = parseUrlOrNull(urlStr)
    if (!parsed || !validateAllowedUrl(parsed)) {
      return false
    }
    return true
  },
  execute: async (args: Record<string, unknown>, _context: ToolContext) => {
    const urlStr = typeof args.url === "string" ? args.url : ""
    const parsed = parseUrlOrNull(urlStr)

    if (!parsed || !validateAllowedUrl(parsed)) {
      return refusedUrlMessage(urlStr)
    }

    const protocol = parsed.protocol.toLowerCase()
    if (protocol !== "http:" && protocol !== "https:") {
      return refusedUrlMessage(urlStr)
    }

    try {
      const result = await httpRequestText(parsed.toString(), {
        method: "GET",
        timeoutMs: deps.timeoutMs ?? DEFAULT_FETCH_TIMEOUT_MS,
        maxBytes: deps.maxBytes ?? DEFAULT_FETCH_MAX_BYTES,
        fetchImpl: deps.fetchImpl,
      })

      let content = result.text
      const contentType = result.headers?.get("content-type") ?? null

      if (isPlainTextOrJson(contentType)) {
        // Pass through unmodified
      } else if (isHtml(contentType) || (!contentType && /<html|<!DOCTYPE/i.test(content))) {
        content = stripHtml(content)
      } else if (/<html|<!DOCTYPE|<script|<style/i.test(content)) {
        content = stripHtml(content)
      }

      const capped = capResult(content, MAX_TOOL_RESULT_BYTES)

      return capped
    } catch (error) {
      return failureMessage(urlStr, error)
    }
  },
}
