import { type ImageType, contentTypeOf } from './resolver/sniff'

const DAY_SECONDS = 24 * 60 * 60
export const FOUND_TTL_SECONDS = 30 * DAY_SECONDS
export const MISSING_TTL_SECONDS = 7 * DAY_SECONDS

const BROWSER_CACHE_FOUND = `public, max-age=${7 * DAY_SECONDS}`
const BROWSER_CACHE_MISSING = `public, max-age=${DAY_SECONDS}`

/**
 * Headers for every icon response. The CSP sandbox means an SVG opened directly in a tab cannot
 * run scripts or load anything; inside `<img>` browsers never run SVG scripts anyway.
 */
const baseHeaders = () =>
  new Headers({
    'Access-Control-Allow-Origin': '*',
    'Cross-Origin-Resource-Policy': 'cross-origin',
    'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; sandbox",
    'X-Content-Type-Options': 'nosniff',
  })

export const iconResponse = (body: Uint8Array, type: ImageType, source: string) => {
  const headers = baseHeaders()
  headers.set('Content-Type', contentTypeOf(type))
  headers.set('Cache-Control', BROWSER_CACHE_FOUND)
  headers.set('X-Favicon-Source', source)
  return new Response(new Uint8Array(body), { status: 200, headers })
}

export const missingResponse = (status: 400 | 403 | 404, cacheable: boolean) => {
  const headers = baseHeaders()
  headers.set('Cache-Control', cacheable ? BROWSER_CACHE_MISSING : 'no-store')
  return new Response(null, { status, headers })
}

/** True when no allow-list is set, the request has no Referer, or the Referer host is listed. */
export const isAllowedReferrer = (referer: string | undefined, allowList: string) => {
  const allowed = allowList
    .split(',')
    .map(entry => entry.trim().toLowerCase())
    .filter(Boolean)
  if (allowed.length === 0 || !referer) return true
  try {
    const { hostname } = new URL(referer)
    return allowed.some(entry => hostname === entry || hostname.endsWith(`.${entry}`))
  } catch {
    return false
  }
}
