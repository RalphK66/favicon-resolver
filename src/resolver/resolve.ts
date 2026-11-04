import { type IconCandidate, iconsFromHtml, iconsFromManifest, sortCandidates } from './discover'
import { type FetchedBody, type FetchFn, fetchLimited } from './fetch-limited'
import { fetchFromGoogle } from './google'
import { type ImageType, sniffImage } from './sniff'

const DEADLINE_MS = 10_000
const GOOGLE_DEADLINE_MS = 4000
const MAX_PAGE_BYTES = 512 * 1024
const MAX_MANIFEST_BYTES = 64 * 1024
const MAX_ICON_BYTES = 512 * 1024
const MAX_ICON_ATTEMPTS = 6
const MAX_FAILURES_PER_RANK = 2
const ICON_ACCEPT = 'image/avif,image/webp,image/png,image/svg+xml,image/*;q=0.8,*/*;q=0.5'

export type ResolvedIcon = {
  body: Uint8Array
  type: ImageType
  source: 'site' | 'google'
}

type ResolveOptions = {
  fetch?: FetchFn
  /** Skip the Google fallback. */
  siteOnly?: boolean
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

const pageOptions = (fetch: FetchFn, signal: AbortSignal) => ({
  fetch,
  accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.5',
  maxBytes: MAX_PAGE_BYTES,
  truncate: true,
  allowErrorStatus: true,
  signal,
})

/**
 * The home page: the first successful answer from `https://`, `http://`, then `https://www.`.
 * When none succeeds, the first error page, because apps behind a login often still send their
 * HTML (and icon links) with a 401 or 403.
 */
const fetchPage = async (hostname: string, fetch: FetchFn, signal: AbortSignal) => {
  const origins = [`https://${hostname}/`, `http://${hostname}/`]
  if (!hostname.startsWith('www.')) origins.push(`https://www.${hostname}/`)
  let errorPage: FetchedBody | null = null
  for (const origin of origins) {
    const page = await fetchLimited(new URL(origin), pageOptions(fetch, signal))
    if (page?.ok) return page
    errorPage ??= page
  }
  return errorPage
}

const candidatesFromPage = async (page: FetchedBody, fetch: FetchFn, signal: AbortSignal) => {
  const html = new TextDecoder().decode(page.body)
  const { candidates, manifestUrl } = iconsFromHtml(html, page.url)

  // The manifest costs a request; only read it when the page offers nothing large or scalable.
  if (!manifestUrl || (candidates[0]?.rank ?? Infinity) <= 1) return candidates
  const manifest = await fetchLimited(manifestUrl, {
    fetch,
    accept: 'application/manifest+json,application/json;q=0.9',
    maxBytes: MAX_MANIFEST_BYTES,
    signal,
  })
  if (!manifest) return candidates
  const fromManifest = iconsFromManifest(new TextDecoder().decode(manifest.body), manifest.url)
  return sortCandidates([...candidates, ...fromManifest])
}

const loadIcon = async (url: URL, fetch: FetchFn, signal: AbortSignal) => {
  const body =
    url.protocol === 'data:'
      ? decodeDataUrl(url)
      : (
          await fetchLimited(url, {
            fetch,
            accept: ICON_ACCEPT,
            maxBytes: MAX_ICON_BYTES,
            signal,
          })
        )?.body
  const type = body && body.byteLength > 0 ? sniffImage(body) : null
  return body && type ? { body, type } : null
}

/**
 * Tries candidates best first. At most two failures per rank, so a page listing nine dead
 * apple-touch icons cannot use up every attempt before reaching a working favicon.
 */
const firstWorkingIcon = async (
  candidates: IconCandidate[],
  tried: Set<string>,
  fetch: FetchFn,
  signal: AbortSignal
) => {
  const failuresByRank = new Map<number, number>()
  let attempts = 0
  for (const candidate of candidates) {
    if (attempts >= MAX_ICON_ATTEMPTS || signal.aborted) break
    const failures = failuresByRank.get(candidate.rank) ?? 0
    if (tried.has(candidate.url.href) || failures >= MAX_FAILURES_PER_RANK) continue
    tried.add(candidate.url.href)
    attempts++
    const icon = await loadIcon(candidate.url, fetch, signal)
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
const fromFaviconIco = async (
  origin: URL,
  tried: Set<string>,
  fetch: FetchFn,
  signal: AbortSignal
) => {
  const response = await fetchLimited(new URL('/favicon.ico', origin), {
    ...pageOptions(fetch, signal),
    accept: ICON_ACCEPT,
  })
  if (!response) return null
  const type = sniffImage(response.body)
  if (type) return response.ok ? { body: response.body, type } : null
  const candidates = await candidatesFromPage(response, fetch, signal)
  return firstWorkingIcon(candidates, tried, fetch, signal)
}

/**
 * True when `final` is the requested host, a subdomain of it, or a parent of it
 * (`example.com` ↔ `www.example.com`). A redirect anywhere else is usually a login page on another
 * site (`id.atlassian.com`, an Okta or Microsoft sign-in), whose icon would be the wrong one.
 */
const isSameSite = (requested: string, final: string) =>
  final === requested || final.endsWith(`.${requested}`) || requested.endsWith(`.${final}`)

/**
 * Finds the best icon for a hostname: the icons its home page declares (and its web app
 * manifest), then `/favicon.ico` (or the icons its error page declares), then Google's favicon
 * service. Returns the original bytes and their sniffed type, or null when nothing usable was found.
 */
export const resolveFavicon = async (
  hostname: string,
  options: ResolveOptions = {}
): Promise<ResolvedIcon | null> => {
  const fetch = options.fetch ?? globalThis.fetch.bind(globalThis)
  const signal = AbortSignal.timeout(DEADLINE_MS)
  const tried = new Set<string>()

  // Icons only ever come from the requested site. A home page that redirects to another site
  // (typically a login) is ignored, and the requested host's own /favicon.ico is tried instead.
  const fetched = await fetchPage(hostname, fetch, signal)
  const page = fetched && isSameSite(hostname, fetched.url.hostname) ? fetched : null
  if (page) {
    const candidates = await candidatesFromPage(page, fetch, signal)
    const icon = await firstWorkingIcon(candidates, tried, fetch, signal)
    if (icon) return { ...icon, source: 'site' }
  }

  const origin = page?.url ?? new URL(`https://${hostname}/`)
  const icon = await fromFaviconIco(origin, tried, fetch, signal)
  if (icon) return { ...icon, source: 'site' }

  if (options.siteOnly) return null
  const body = await fetchFromGoogle(hostname, fetch, AbortSignal.timeout(GOOGLE_DEADLINE_MS))
  return body ? { body, type: 'png', source: 'google' } : null
}
