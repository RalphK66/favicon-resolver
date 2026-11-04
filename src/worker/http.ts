import { sha256Hex } from '../resolver/hash'
import { type ImageType, contentTypeOf } from '../resolver/sniff'
import { isHostOrSubdomain } from '../resolver/url-guard'

const DAY_SECONDS = 24 * 60 * 60
const HOUR_SECONDS = 60 * 60
export const FOUND_TTL_SECONDS = 30 * DAY_SECONDS
export const MISSING_TTL_SECONDS = 7 * DAY_SECONDS

/** How long a browser may keep a miss: a day for a real miss, an hour when the site did not answer. */
export type MissCache = 'day' | 'hour' | 'none'

const BROWSER_CACHE_FOUND = `public, max-age=${7 * DAY_SECONDS}`
const BROWSER_CACHE_MISSING: Record<MissCache, string> = {
  day: `public, max-age=${DAY_SECONDS}`,
  hour: `public, max-age=${HOUR_SECONDS}`,
  none: 'no-store',
}

/**
 * Headers for every response. The CSP sandbox means an SVG opened directly in a tab cannot
 * run scripts or load anything; inside `<img>` browsers never run SVG scripts anyway.
 */
const baseHeaders = () =>
  new Headers({
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Expose-Headers': 'ETag, X-Favicon-Source',
    'Cross-Origin-Resource-Policy': 'cross-origin',
    'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; sandbox",
    'X-Content-Type-Options': 'nosniff',
  })

/** A strong ETag from the icon bytes, so a browser can revalidate without downloading again. */
export const etagOf = async (body: Uint8Array) => `"${await sha256Hex(body)}"`

const etagMatches = (etag: string, ifNoneMatch: string | null | undefined) =>
  (ifNoneMatch ?? '')
    .split(',')
    .map(token => token.trim())
    .some(token => token === '*' || token === etag || token === `W/${etag}`)

export const iconResponse = (props: {
  body: Uint8Array
  type: ImageType
  source: string
  etag: string
  ifNoneMatch?: string | null
}) => {
  const { body, type, source, etag, ifNoneMatch } = props
  const headers = baseHeaders()
  headers.set('Cache-Control', BROWSER_CACHE_FOUND)
  headers.set('ETag', etag)
  headers.set('X-Favicon-Source', source)
  if (etagMatches(etag, ifNoneMatch)) return new Response(null, { status: 304, headers })
  headers.set('Content-Type', contentTypeOf(type))
  return new Response(new Uint8Array(body), { status: 200, headers })
}

export const missingResponse = (status: 400 | 403 | 404, cache: MissCache) => {
  const headers = baseHeaders()
  headers.set('Cache-Control', BROWSER_CACHE_MISSING[cache])
  return new Response(null, { status, headers })
}

/** True when no allow-list is set, the request has no Referer, or the Referer host is listed. */
export const isAllowedReferrer = (referer: string | null | undefined, allowList: string) => {
  const allowed = allowList
    .split(',')
    .map(entry => entry.trim().toLowerCase())
    .filter(Boolean)
  if (allowed.length === 0 || !referer) return true
  try {
    const { hostname } = new URL(referer)
    return allowed.some(entry => isHostOrSubdomain(hostname, entry))
  } catch {
    return false
  }
}
