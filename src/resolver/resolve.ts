import { type IconCandidate, iconsFromHtml, iconsFromManifest, sortCandidates } from './discover'
import { type FetchFn, fetchLimited } from './fetch-limited'
import { fetchFromGoogle } from './google'
import { type ImageType, sniffImage } from './sniff'

const DEADLINE_MS = 10_000
const GOOGLE_DEADLINE_MS = 4000
const MAX_PAGE_BYTES = 512 * 1024
const MAX_MANIFEST_BYTES = 64 * 1024
const MAX_ICON_BYTES = 512 * 1024
const MAX_ICON_ATTEMPTS = 5

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

const fetchPage = async (hostname: string, fetch: FetchFn, signal: AbortSignal) => {
  const options = {
    fetch,
    accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.5',
    maxBytes: MAX_PAGE_BYTES,
    truncate: true,
    signal,
  }
  const origins = [`https://${hostname}/`, `http://${hostname}/`]
  if (!hostname.startsWith('www.')) origins.push(`https://www.${hostname}/`)
  for (const origin of origins) {
    const page = await fetchLimited(new URL(origin), options)
    if (page) return page
  }
  return null
}

const findCandidates = async (hostname: string, fetch: FetchFn, signal: AbortSignal) => {
  const page = await fetchPage(hostname, fetch, signal)
  if (!page) return [new URL(`https://${hostname}/favicon.ico`)]

  const html = new TextDecoder().decode(page.body)
  let { candidates, manifestUrl } = iconsFromHtml(html, page.url)

  // The manifest costs a request; only read it when the page offers nothing large or scalable.
  if (manifestUrl && (candidates[0]?.rank ?? Infinity) > 1) {
    const manifest = await fetchLimited(manifestUrl, {
      fetch,
      accept: 'application/manifest+json,application/json;q=0.9',
      maxBytes: MAX_MANIFEST_BYTES,
      signal,
    })
    if (manifest) {
      const fromManifest = iconsFromManifest(new TextDecoder().decode(manifest.body), manifest.url)
      candidates = sortCandidates([...candidates, ...fromManifest])
    }
  }

  const fallback: IconCandidate = { url: new URL('/favicon.ico', page.url), rank: 5, size: 0 }
  const seen = new Set<string>()
  return [...candidates, fallback]
    .map(candidate => candidate.url)
    .filter(url => !seen.has(url.href) && Boolean(seen.add(url.href)))
}

const loadIcon = async (url: URL, fetch: FetchFn, signal: AbortSignal) => {
  if (url.protocol === 'data:') return decodeDataUrl(url)
  const result = await fetchLimited(url, {
    fetch,
    accept: 'image/avif,image/webp,image/png,image/svg+xml,image/*;q=0.8,*/*;q=0.5',
    maxBytes: MAX_ICON_BYTES,
    signal,
  })
  return result?.body ?? null
}

/**
 * Finds the best icon for a hostname: the icons its home page declares (and its web app
 * manifest), then `/favicon.ico`, then Google's favicon service. Returns the original bytes and
 * their sniffed type, or null when nothing usable was found.
 */
export const resolveFavicon = async (
  hostname: string,
  options: ResolveOptions = {}
): Promise<ResolvedIcon | null> => {
  const fetch = options.fetch ?? globalThis.fetch.bind(globalThis)
  const signal = AbortSignal.timeout(DEADLINE_MS)

  const candidates = await findCandidates(hostname, fetch, signal)
  for (const url of candidates.slice(0, MAX_ICON_ATTEMPTS)) {
    if (signal.aborted) break
    const body = await loadIcon(url, fetch, signal)
    const type = body && body.byteLength > 0 ? sniffImage(body) : null
    if (body && type) return { body, type, source: 'site' }
  }

  if (options.siteOnly) return null
  const body = await fetchFromGoogle(hostname, fetch, AbortSignal.timeout(GOOGLE_DEADLINE_MS))
  return body ? { body, type: 'png', source: 'google' } : null
}
