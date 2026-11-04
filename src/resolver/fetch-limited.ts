import { isFetchableUrl, isSameSite } from './url-guard'

const MAX_REDIRECTS = 5
/** Per request, so one host that never answers cannot use up the whole deadline. */
const REQUEST_TIMEOUT_MS = 4000
const USER_AGENT = 'Mozilla/5.0 (compatible; favicon-resolver/1.0)'

export type FetchFn = (input: Request | string | URL, init?: RequestInit) => Promise<Response>

export type FetchedBody = {
  /** Final URL after redirects. */
  url: URL
  body: Uint8Array
  /** False for a 4xx/5xx body returned because `allowErrorStatus` was set. */
  ok: boolean
  /** True when the body was cut at `maxBytes` (only with `truncate`). */
  truncated: boolean
}

type FetchLimitedOptions = {
  fetch: FetchFn
  accept: string
  maxBytes: number
  /** Keep the first `maxBytes` instead of failing (HTML: icons are declared in `<head>`). */
  truncate?: boolean
  /**
   * Also return the body of 4xx/5xx answers. Apps behind a login often send their usual HTML,
   * icon links included, on their 401, 403, and 404 pages.
   */
  allowErrorStatus?: boolean
  /**
   * Refuse every hop, redirects included, that leaves this site (see `isSameSite`). A page that
   * redirects to a login provider is then not fetched at all.
   */
  sameSiteAs?: string
  signal: AbortSignal
}

const readCapped = async (response: Response, options: FetchLimitedOptions) => {
  const declared = Number(response.headers.get('content-length') ?? 0)
  if (declared > options.maxBytes && !options.truncate) return null
  if (!response.body) return { body: new Uint8Array(), truncated: false }

  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  let truncated = false
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      chunks.push(value)
      total += value.byteLength
      if (total > options.maxBytes) {
        if (!options.truncate) return null
        truncated = true
        break
      }
    }
  } finally {
    void reader.cancel().catch(() => undefined)
  }

  const body = new Uint8Array(Math.min(total, options.maxBytes))
  let offset = 0
  for (const chunk of chunks) {
    const room = body.length - offset
    if (room <= 0) break
    body.set(chunk.subarray(0, room), offset)
    offset += Math.min(chunk.byteLength, room)
  }
  return { body, truncated }
}

/**
 * GET with redirects followed by hand, so every hop is checked with `isFetchableUrl` (and
 * `sameSiteAs`) before it is requested. Oversized bodies, timeouts, network errors, and (unless
 * `allowErrorStatus`) non-2xx answers all return null.
 */
export const fetchLimited = async (
  input: URL,
  options: FetchLimitedOptions
): Promise<FetchedBody | null> => {
  let url = input
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    if (options.signal.aborted || !isFetchableUrl(url)) return null
    if (options.sameSiteAs && !isSameSite(options.sameSiteAs, url.hostname)) return null

    let response: Response
    try {
      response = await options.fetch(url, {
        redirect: 'manual',
        signal: AbortSignal.any([options.signal, AbortSignal.timeout(REQUEST_TIMEOUT_MS)]),
        headers: { 'User-Agent': USER_AGENT, Accept: options.accept },
      })
    } catch {
      return null
    }

    const location = response.headers.get('location')
    if (response.status >= 300 && response.status < 400 && location) {
      void response.body?.cancel().catch(() => undefined)
      try {
        url = new URL(location, url)
      } catch {
        return null
      }
      continue
    }

    if (!response.ok && !options.allowErrorStatus) {
      void response.body?.cancel().catch(() => undefined)
      return null
    }

    const read = await readCapped(response, options).catch(() => null)
    return read ? { url, ...read, ok: response.ok } : null
  }
  return null
}
