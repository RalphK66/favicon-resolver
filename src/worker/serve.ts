import { type IconStore, readCachedIcon, writeCachedIcon } from './cache'
import { etagOf, iconResponse, isAllowedReferrer, missingResponse } from './http'
import { DEFAULT_TARGET_SIZE } from '../resolver/discover'
import { type ResolveResult, resolveFavicon } from '../resolver/resolve'
import { hostnameOf } from '../resolver/url-guard'

/** Sizes a request can ask for; anything else rounds up, so a site has at most five cache entries. */
const SIZES = [16, 32, 64, 128, 256]

export const sizeOf = (query: string | null) => {
  const wanted = Number(query)
  if (!query || !Number.isFinite(wanted)) return DEFAULT_TARGET_SIZE
  return SIZES.find(size => size >= wanted) ?? SIZES[SIZES.length - 1]
}

type ServeOptions = {
  kv: IconStore
  /** The `ALLOWED_REFERRERS` setting. */
  allowedReferrers: string
  /** Runs a task after the response is sent (`ctx.waitUntil`). */
  waitUntil: (task: Promise<unknown>) => void
  resolve?: (hostname: string, options: { size: number }) => Promise<ResolveResult>
}

/**
 * `GET /<hostname or URL>[?size=]` → the best icon, 404 when there is none. Runtime-agnostic:
 * the route hands in the request, the path, and the Cloudflare bindings.
 */
export const serveIcon = async (request: Request, target: string, options: ServeOptions) => {
  const { kv, allowedReferrers, waitUntil, resolve = resolveFavicon } = options
  if (!isAllowedReferrer(request.headers.get('Referer'), allowedReferrers)) {
    return missingResponse(403, 'none')
  }

  const hostname = hostnameOf(target)
  if (!hostname) return missingResponse(400, 'day')
  const size = sizeOf(new URL(request.url).searchParams.get('size'))
  const ifNoneMatch = request.headers.get('If-None-Match')

  const cached = await readCachedIcon(kv, hostname, size)
  if (cached) {
    return cached.found
      ? iconResponse({ ...cached.icon, etag: cached.etag, ifNoneMatch })
      : missingResponse(404, 'day')
  }

  const result = await resolve(hostname, { size })
  if (result.icon) {
    const etag = await etagOf(result.icon.body)
    waitUntil(
      writeCachedIcon(kv, hostname, size, { icon: result.icon, etag }).catch(() => undefined)
    )
    return iconResponse({ ...result.icon, etag, ifNoneMatch })
  }
  // A site that did not answer is not cached in KV; the browser retries after an hour.
  if (result.reason === 'none') {
    waitUntil(writeCachedIcon(kv, hostname, size, null).catch(() => undefined))
  }
  return missingResponse(404, result.reason === 'none' ? 'day' : 'hour')
}
