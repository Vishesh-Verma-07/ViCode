/**
 * The one place outbound HTTP happens in ViCode.
 *
 * Every network call needs the same three things and, before this existed, none
 * of them had them: a timeout so an unresponsive host cannot hang a Turn, a
 * byte ceiling enforced while the response streams rather than after it has
 * buffered, and typed failures so "the network broke" and "the body was not
 * what we expected" are distinguishable rather than one string.
 *
 * The four failures are separate kinds on one error type, because a caller has
 * to act on each differently: a timeout is worth a retry, a status may be a
 * credential problem, a transport failure is a network fact, and a malformed
 * body means the response shape moved under us.
 */

export const DEFAULT_HTTP_TIMEOUT_MS = 15_000

/** 4 MB: a general ceiling that bounds memory. A caller expecting a larger
 * payload — the Model Catalog, say — declares its own rather than leaning on this. */
export const DEFAULT_HTTP_MAX_BYTES = 4 * 1024 * 1024

export type HttpFailureKind = "timeout" | "status" | "transport" | "malformed"

export class HttpError extends Error {
  readonly kind: HttpFailureKind
  readonly url: string
  /** The status, when the failure was one. Null for every other kind. */
  readonly status: number | null

  constructor(kind: HttpFailureKind, url: string, message: string, status: number | null = null) {
    super(message)
    this.name = "HttpError"
    this.kind = kind
    this.url = url
    this.status = status
  }
}

export interface HttpRequestOptions {
  method?: string
  headers?: Record<string, string>
  body?: string
  timeoutMs?: number
  maxBytes?: number
  /**
   * A fetch-shaped transport to use instead of the global one, so a test never
   * touches the network. The Model Catalog already accepted this shape; it is
   * now the boundary's own.
   */
  fetchImpl?: typeof fetch
}

export interface HttpTextResult {
  text: string
  /** Bytes read, which is the capped count rather than the full body's. */
  bytes: number
  /** True when the ceiling cut the body short. */
  truncated: boolean
  status: number
}

export interface HttpJsonResult<T> extends HttpTextResult {
  json: T
}

function isContinuationByte(byte: number): boolean {
  return (byte & 0b1100_0000) === 0b1000_0000
}

/** How many bytes the UTF-8 character starting with this lead byte occupies. */
function utf8SequenceLength(lead: number): number {
  if (lead < 0x80) return 1
  if (lead < 0xe0) return 2
  if (lead < 0xf0) return 3
  return 4
}

/**
 * Trims a partial UTF-8 sequence off the end of a capped body.
 *
 * A cut that lands mid-character would otherwise decode to U+FFFD, which reads
 * to the model as content rather than as the place the body stopped. The
 * truncated sequence is dropped whole — back to its lead byte — so the text
 * ends on the last character that was actually complete.
 */
function trimPartialCharacter(bytes: Uint8Array): Uint8Array {
  let end = bytes.length
  let lead = end - 1
  let continuations = 0
  while (lead >= 0 && isContinuationByte(bytes[lead]!) && continuations < 3) {
    lead--
    continuations++
  }
  if (lead < 0) return bytes
  const needed = utf8SequenceLength(bytes[lead]!)
  if (needed > 1 && needed > end - lead) return bytes.subarray(0, lead)
  return bytes
}

/**
 * Reads at most `maxBytes` from the response, stopping the stream there.
 *
 * The read is abandoned at the ceiling rather than after the body has buffered,
 * because a large download must not exhaust memory before the cap applies: with
 * a `ReadableStream` the reader is cancelled, which stops the producer.
 */
async function readCapped(response: Response, maxBytes: number): Promise<{
  bytes: Uint8Array
  truncated: boolean
}> {
  const body = response.body
  if (!body) {
    const whole = new Uint8Array(await response.arrayBuffer())
    if (whole.length <= maxBytes) return { bytes: whole, truncated: false }
    return { bytes: whole.subarray(0, maxBytes), truncated: true }
  }

  const reader = body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  let truncated = false
  let reachedCeiling = false

  try {
    while (total < maxBytes) {
      const { done, value } = await reader.read()
      if (done) break
      if (!value) continue
      const room = maxBytes - total
      if (value.length > room) {
        // A chunk may overshoot the ceiling; keep only the part that fits, so
        // the cap is a real ceiling rather than a suggestion.
        chunks.push(value.subarray(0, room))
        total = maxBytes
        truncated = true
        break
      }
      chunks.push(value)
      total += value.length
      reachedCeiling = total >= maxBytes
    }
    if (reachedCeiling) {
      // The body may end exactly at the cap, which is not truncation. One more
      // read settles it — and on a body that keeps going it is the read that
      // finds out, still without buffering what lies past the ceiling.
      const { done } = await reader.read()
      truncated = !done
    }
  } finally {
    await reader.cancel().catch(() => undefined)
    reader.releaseLock()
  }

  const joined = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    joined.set(chunk, offset)
    offset += chunk.length
  }
  return { bytes: joined, truncated }
}

/**
 * One HTTP request, with every guarantee the boundary exists to provide.
 *
 * Throws `HttpError` for the four failure kinds; a success resolves with the
 * body text, how many bytes it was, and whether the ceiling cut it.
 *
 * The timeout spans the whole exchange rather than the handshake: a host that
 * answers with headers and then stalls mid-body has failed just as surely as one
 * that never answers, and leaving the second case unbounded would let the
 * timeout promise mean less than it says.
 */
export async function httpRequestText(
  url: string,
  options: HttpRequestOptions = {},
): Promise<HttpTextResult> {
  const {
    method = "GET",
    headers,
    body,
    timeoutMs = DEFAULT_HTTP_TIMEOUT_MS,
    maxBytes = DEFAULT_HTTP_MAX_BYTES,
    fetchImpl = fetch,
  } = options

  const controller = new AbortController()
  let timedOut = false
  const timer = setTimeout(() => {
    timedOut = true
    controller.abort()
  }, timeoutMs)

  const timeoutError = () =>
    new HttpError("timeout", url, `request to ${url} timed out after ${timeoutMs}ms`)

  try {
    let response: Response
    try {
      response = await fetchImpl(url, {
        method,
        headers,
        body,
        signal: controller.signal,
      })
    } catch (error) {
      // An abort we raised is a timeout; anything else is the network. Reading it
      // from our own flag rather than the error keeps a caller's own cancellation
      // from being reported as one the host never answered.
      if (timedOut) throw timeoutError()
      throw new HttpError(
        "transport",
        url,
        `could not reach ${url}: ${error instanceof Error ? error.message : String(error)}`,
      )
    }

    if (!response.ok) {
      throw new HttpError(
        "status",
        url,
        `${url} responded with HTTP ${response.status}`,
        response.status,
      )
    }

    let read: { bytes: Uint8Array; truncated: boolean }
    try {
      read = await readCapped(response, maxBytes)
    } catch (error) {
      // The status line arrived, so this is not a status problem and not a
      // malformed body either — the connection died part-way through delivering
      // something the host had already promised to send.
      if (timedOut) throw timeoutError()
      throw new HttpError(
        "transport",
        url,
        `the response from ${url} broke part-way through: ${
          error instanceof Error ? error.message : String(error)
        }`,
      )
    }

    const text = new TextDecoder().decode(trimPartialCharacter(read.bytes))
    return { text, bytes: read.bytes.length, truncated: read.truncated, status: response.status }
  } finally {
    clearTimeout(timer)
  }
}

/** `httpRequestText` plus a JSON parse, so a malformed body is its own kind. */
export async function httpRequestJson<T = unknown>(
  url: string,
  options: HttpRequestOptions = {},
): Promise<HttpJsonResult<T>> {
  const result = await httpRequestText(url, options)
  try {
    return { ...result, json: JSON.parse(result.text) as T }
  } catch {
    throw new HttpError("malformed", url, `${url} returned a body that is not valid JSON`)
  }
}