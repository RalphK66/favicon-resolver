import { defineEnv, string } from 'void/env'

export default defineEnv({
  /**
   * Comma-separated hostnames allowed to embed icons, e.g. `example.com,localhost`.
   * Requests whose Referer is another site get 403. Empty allows every site.
   */
  ALLOWED_REFERRERS: string().default(''),
})
