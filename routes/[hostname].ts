import { defineHandler } from 'void'
import { env } from 'void/env'

import { readCachedIcon, writeCachedIcon } from '../src/cache'
import { iconResponse, isAllowedReferrer, missingResponse } from '../src/http'
import { resolveFavicon } from '../src/resolver/resolve'
import { isPublicHostname } from '../src/resolver/url-guard'

/** GET /github.com → the best icon for github.com, or 404 when there is none. */
export const GET = defineHandler(async c => {
  if (!isAllowedReferrer(c.req.header('Referer'), env.ALLOWED_REFERRERS)) {
    return missingResponse(403, false)
  }

  const hostname = (c.req.param('hostname') ?? '').toLowerCase().replace(/\.$/, '')
  if (!isPublicHostname(hostname)) return missingResponse(400, true)

  const cached = await readCachedIcon(c.env.KV, hostname)
  if (cached) {
    return cached.found
      ? iconResponse(cached.icon.body, cached.icon.type, cached.icon.source)
      : missingResponse(404, true)
  }

  const icon = await resolveFavicon(hostname)
  c.executionCtx.waitUntil(writeCachedIcon(c.env.KV, hostname, icon))
  return icon ? iconResponse(icon.body, icon.type, icon.source) : missingResponse(404, true)
})
