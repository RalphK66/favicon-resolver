import {
  DEFAULT_TARGET_SIZE,
  type IconCandidate,
  iconsFromHtml,
  iconsFromManifest,
  sortCandidates,
} from './discover'
import { type FetchedBody, type FetchFn, fetchLimited } from './fetch-limited'
import { fetchFromGoogle } from './google'
import { type ImageType, sniffImage } from './sniff'
import { isSameSite } from './url-guard'

const DEADLINE_MS = 10_000
const GOOGLE_DEADLINE_MS = 4000
const MAX_PAGE_BYTES = 512 * 1024
const MAX_MANIFEST_BYTES = 64 * 1024
const MAX_ICON_BYTES = 512 * 1024
const MAX_ICON_ATTEMPTS = 6
const MAX_FAILURES_PER_RANK = 2
// Only formats `sniffImage` recognises, so a CDN that negotiates formats cannot send one we refuse.
const ICON_ACCEPT = 'image/avif,image/webp,image/png,image/svg+xml,image/*;q=0.8,*/*;q=0.5'

export type ResolvedIcon = {
  body: Uint8Array
  type: ImageType
  source: 'site' | 'google'
}

export type ResolveResult =
  | { icon: ResolvedIcon }
  /**
   * `none`: the site answered and declares nothing usable; a stable result. `error`: the site did
   * not answer (DNS, network, 5xx) or the lookup timed out; worth retrying soon.
   */
  | { icon: null; reason: 'none' | 'error' }

type ResolveOptions = {
  fetch?: FetchFn
  /** Skip the Google fallback. */
  siteOnly?: boolean
  /** Preferred icon side in px: the smallest raster at or above it wins. Default 64. */
  size?: number
}

const decodeDataUrl = (url: URL): Uint8Array | null => {
  const href = url.href
  const comma = href.indexOf(',')
  if (comma === -1 || href.length > MAX_ICON_BYTES * 2) return null
  const meta = href.slice(5, comma).toLowerCase()
  const payload = href.slice(comma + 1)
  try {
    if (meta.endsWith(';base64')) return Uint8Array.from(atob(payload), char => char.charCodeAt(0))
    return new TextEncoder().encode(decodeURIComponent(payload))
  } catch {
    return null
  }
}

type Lookup = {
  hostname: string
  size: number
  fetch: FetchFn
  signal: AbortSignal
  /** Icon URLs already tried, shared across stages. */
  tried: Set<string>
}

const pageOptions = ({ hostname, fetch, signal }: Lookup) => ({
  fetch,
  accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.5',
  maxBytes: MAX_PAGE_BYTES,
  truncate: true,
  allowErrorStatus: true,
  sameSiteAs: hostname,
  signal,
})

/**
 * The home page: the first successful answer from `https://`, `http://`, then `https://www.`.
 * When none succeeds, the first error page, because apps behind a login often still send their
 * HTML (and icon links) with a 401 or 403. An origin that redirects to another site (usually a
 * login provider) counts as no answer, so the next origin is still tried.
 */
const fetchPage = async (lookup: Lookup) => {
  const { hostname } = lookup
  const origins = [`https://${hostname}/`, `http://${hostname}/`]
  if (!hostname.startsWith('www.')) origins.push(`https://www.${hostname}/`)
  let errorPage: FetchedBody | null = null
  for (const origin of origins) {
    const page = await fetchLimited(new URL(origin), pageOptions(lookup))
    if (page?.ok) return page
    errorPage ??= page
  }
  return errorPage
}

const candidatesFromPage = async (page: FetchedBody, lookup: Lookup) => {
  const { size, fetch, signal } = lookup
  const html = new TextDecoder().decode(page.body)
  const { candidates, manifestUrl } = iconsFromHtml(html, page.url, size)

  // The manifest costs a request; only read it when the page offers nothing large or scalable.
  if (!manifestUrl || (candidates[0]?.rank ?? Infinity) <= 1) return candidates
  const manifest = await fetchLimited(manifestUrl, {
    fetch,
    accept: 'application/manifest+json,application/json;q=0.9',
    maxBytes: MAX_MANIFEST_BYTES,
    signal,
  })
  if (!manifest) return candidates
  const fromManifest = iconsFromManifest(
    new TextDecoder().decode(manifest.body),
    manifest.url,
    size
  )
  return sortCandidates([...candidates, ...fromManifest])
}

const loadIcon = async (url: URL, { fetch, signal }: Lookup) => {
  const body =
    url.protocol === 'data:'
      ? decodeDataUrl(url)
      : (await fetchLimited(url, { fetch, accept: ICON_ACCEPT, maxBytes: MAX_ICON_BYTES, signal }))
          ?.body
  const type = body && body.byteLength > 0 ? sniffImage(body) : null
  return body && type ? { body, type } : null
}

/**
 * Tries candidates best first. At most two failures per rank, so a page listing nine dead
 * apple-touch icons cannot use up every attempt before reaching a working favicon.
 */
const firstWorkingIcon = async (candidates: IconCandidate[], lookup: Lookup) => {
  const { tried, signal } = lookup
  const failuresByRank = new Map<number, number>()
  let attempts = 0
  for (const candidate of candidates) {
    if (attempts >= MAX_ICON_ATTEMPTS || signal.aborted) break
    const failures = failuresByRank.get(candidate.rank) ?? 0
    if (tried.has(candidate.url.href) || failures >= MAX_FAILURES_PER_RANK) continue
    tried.add(candidate.url.href)
    attempts++
    const icon = await loadIcon(candidate.url, lookup)
    if (icon) return icon
    failuresByRank.set(candidate.rank, failures + 1)
  }
  return null
}

/**
 * `/favicon.ico` is either the icon itself or, on many apps, an HTML error page that still lists
 * the app's real icons (TeamCity behind a login answers its home page with a bare 401, but its
 * 404 page names `/img/icons/favicon.ico`).
 */
const fromFaviconIco = async (origin: URL, lookup: Lookup) => {
  const response = await fetchLimited(new URL('/favicon.ico', origin), {
    ...pageOptions(lookup),
    accept: ICON_ACCEPT,
  })
  if (!response) return null
  const type = sniffImage(response.body)
  // The page limit truncates; an icon cut short would be served broken.
  if (type) return response.ok && !response.truncated ? { body: response.body, type } : null
  const candidates = await candidatesFromPage(response, lookup)
  return firstWorkingIcon(candidates, lookup)
}

/**
 * Finds the best icon for a hostname: the icons its home page declares (and its web app
 * manifest), then `/favicon.ico` (or the icons its error page declares), then Google's favicon
 * service. Pages are only ever read from the requested site itself; icon files may live anywhere.
 */
export const resolveFavicon = async (
  hostname: string,
  options: ResolveOptions = {}
): Promise<ResolveResult> => {
  const baseFetch = options.fetch ?? globalThis.fetch.bind(globalThis)
  // Set once the site itself answers (below 5xx): an empty result is then final, not a network blip.
  let reached = false
  const fetch: FetchFn = async (input, init) => {
    const response = await baseFetch(input, init)
    const host = new URL(input instanceof Request ? input.url : input).hostname
    if (response.status < 500 && isSameSite(hostname, host)) reached = true
    return response
  }
  const lookup: Lookup = {
    hostname,
    size: options.size ?? DEFAULT_TARGET_SIZE,
    fetch,
    signal: AbortSignal.timeout(DEADLINE_MS),
    tried: new Set(),
  }

  const page = await fetchPage(lookup)
  if (page) {
    const icon = await firstWorkingIcon(await candidatesFromPage(page, lookup), lookup)
    if (icon) return { icon: { ...icon, source: 'site' } }
  }

  const origin = page?.url ?? new URL(`https://${hostname}/`)
  const icon = await fromFaviconIco(origin, lookup)
  if (icon) return { icon: { ...icon, source: 'site' } }

  if (!options.siteOnly) {
    const body = await fetchFromGoogle(
      hostname,
      lookup.size,
      fetch,
      AbortSignal.timeout(GOOGLE_DEADLINE_MS)
    )
    if (body) return { icon: { body, type: 'png', source: 'google' } }
  }
  return { icon: null, reason: reached && !lookup.signal.aborted ? 'none' : 'error' }
}
