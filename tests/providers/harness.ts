/**
 * Shared plumbing for the Provider adapter tests.
 *
 * An adapter is the only place where ViCode's request meets a wire format, so
 * every suite here drives a real SDK client against a recorded `fetch` rather
 * than a stubbed Provider. What is asserted is the request that would have gone
 * out and the events that came back — which is exactly what differs between the
 * vendors, and what a stub at the Provider seam would hide.
 *
 * The catalog is a fixture rather than the real snapshot: `setActiveCatalog`
 * is the injection point, and a Protocol, a price and a window per Model are
 * all a test needs.
 */
import type { Catalog } from "@/core/catalog"
import type { StreamEvent, TokenUsage } from "@/core/provider"

/**
 * The SDK logs a compatibility warning for every Model it has never heard of
 * when one is called over a dialect it recognises — which is every Model on a
 * Gateway that resells other Vendors', Go included. Expected here rather than
 * newsworthy, and noisy enough to bury a real failure, so it is off.
 */
;(globalThis as { AI_SDK_LOG_WARNINGS?: unknown }).AI_SDK_LOG_WARNINGS = false

/**
 * One Model per registered Provider, each with a Protocol ViCode can call, plus
 * one Gateway Model speaking a Protocol it cannot — so per-Model transport
 * resolution has both an answer and a refusal to assert.
 */
export const TEST_CATALOG: Catalog = {
  providers: {
    openrouter: {
      "openai/gpt-4o": {
        id: "openai/gpt-4o",
        name: "GPT-4o",
        protocol: "openai",
        contextLength: 128_000,
        pricing: { inputPricePerToken: 2.5 / 1_000_000, outputPricePerToken: 10 / 1_000_000 },
      },
    },
    openai: {
      "gpt-5.3-codex": {
        id: "gpt-5.3-codex",
        name: "GPT-5.3 Codex",
        protocol: "openai",
        contextLength: 400_000,
        pricing: { inputPricePerToken: 1.25 / 1_000_000, outputPricePerToken: 10 / 1_000_000 },
      },
    },
    anthropic: {
      "claude-opus-5-5": {
        id: "claude-opus-5-5",
        name: "Claude Opus 5.5",
        protocol: "anthropic",
        contextLength: 200_000,
        pricing: {
          inputPricePerToken: 5 / 1_000_000,
          outputPricePerToken: 25 / 1_000_000,
          cacheReadPricePerToken: 0.5 / 1_000_000,
          cacheWritePricePerToken: 6.25 / 1_000_000,
        },
      },
    },
    opencode: {
      "claude-sonnet-4-5": {
        id: "claude-sonnet-4-5",
        name: "Claude Sonnet 4.5",
        protocol: "anthropic",
        contextLength: 200_000,
        pricing: { inputPricePerToken: 3 / 1_000_000, outputPricePerToken: 15 / 1_000_000 },
      },
      "gpt-5": {
        id: "gpt-5",
        name: "GPT-5",
        protocol: "openai",
        contextLength: 400_000,
        pricing: { inputPricePerToken: 1.25 / 1_000_000, outputPricePerToken: 10 / 1_000_000 },
      },
      "gemini-3-pro": {
        id: "gemini-3-pro",
        name: "Gemini 3 Pro",
        protocol: "google",
        contextLength: 1_000_000,
        pricing: null,
      },
    },
    "opencode-go": {
      "grok-code": {
        id: "grok-code",
        name: "Grok Code",
        protocol: "anthropic",
        contextLength: 256_000,
        // Priced on paper, but Go bills by subscription — the price must never
        // reach a Turn's cost.
        pricing: { inputPricePerToken: 1 / 1_000_000, outputPricePerToken: 2 / 1_000_000 },
      },
    },
  },
}

/** The wire Model an adapter test drives, named after the Provider it sits on. */
export const WIRE_MODEL = {
  anthropic: "claude-opus-5-5",
  openai: "gpt-5.3-codex",
  opencode: "claude-sonnet-4-5",
  "opencode-go": "grok-code",
} as const

/** One HTTP request as it would have left the process. */
export interface RecordedRequest {
  url: string
  headers: Headers
  /** The JSON body, parsed. Every Provider here posts JSON. */
  body: Record<string, unknown>
}

export interface ApiRecorder {
  /** Every request sent, in order. */
  readonly requests: RecordedRequest[]
  /** The single request sent. Throws when there was not exactly one. */
  only(): RecordedRequest
}

/**
 * Replaces `fetch` for the duration of a test and records what goes through it.
 *
 * The SDK clients resolve `fetch` per request rather than capturing it at
 * construction, so swapping the global is enough to intercept a real request.
 * Return the value the caller wants to assert on to restore the original.
 */
export function recordApi(respond: () => Response): ApiRecorder {
  const requests: RecordedRequest[] = []
  const original = globalThis.fetch

  globalThis.fetch = (async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    const url = input instanceof Request ? input.url : String(input)
    const raw = typeof init?.body === "string" ? init.body : ""
    // Every route here posts JSON, so a body that will not parse is a change
    // worth failing on rather than reporting as an empty one.
    const body: Record<string, unknown> = raw ? JSON.parse(raw) : {}
    requests.push({ url, headers: new Headers(init?.headers), body })
    return respond()
  }) as typeof fetch

  return {
    requests,
    only() {
      if (requests.length !== 1) {
        throw new Error(`Expected exactly one request, got ${requests.length}`)
      }
      return requests[0]!
    },
  }
}

/** Restores whatever `fetch` was before `recordApi` replaced it. */
export function restoreFetch(original: typeof fetch): void {
  globalThis.fetch = original
}

/** Builds a `text/event-stream` Response body from wire events. */
export function sse(events: { event?: string; data: unknown }[]): string {
  return events
    .map((e) => `${e.event ? `event: ${e.event}\n` : ""}data: ${JSON.stringify(e.data)}\n\n`)
    .join("")
}

/** A stream Response carrying `body` as SSE, which is every Provider here. */
export function streamResponse(body: string): Response {
  return new Response(body, { headers: { "content-type": "text/event-stream" } })
}

/** Drains a Provider's stream into the events it yielded. */
export async function collect(
  events: AsyncIterable<StreamEvent>,
): Promise<StreamEvent[]> {
  const out: StreamEvent[] = []
  for await (const event of events) out.push(event)
  return out
}

/** The one `finish` event in a stream, which is where its usage arrives. */
export function finishOf(events: StreamEvent[]): StreamEvent & { usage: TokenUsage } {
  const finish = events.find((e) => e.type === "finish")
  if (!finish?.usage) {
    throw new Error(`No finish event with usage in: ${events.map((e) => e.type).join(", ")}`)
  }
  return finish as StreamEvent & { usage: TokenUsage }
}