import { defineHandler } from 'void'
import { env } from 'void/env'

import { serveIcon } from '../src/worker/serve'

/** GET /github.com (or /https://github.com/some/page) → the best icon, or 404 when there is none. */
export const GET = defineHandler(c =>
  serveIcon(c.req.raw, c.req.param('target') ?? '', {
    kv: c.env.KV,
    allowedReferrers: env.ALLOWED_REFERRERS,
    waitUntil: task => c.executionCtx.waitUntil(task),
  })
)
