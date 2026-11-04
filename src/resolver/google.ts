import { type FetchFn, fetchLimited } from './fetch-limited'
import { TARGET_SIZE } from './discover'
import { pngSize } from './sniff'

const MAX_BYTES = 256 * 1024
// Google answers with a 16×16 globe when it has no icon, even when a larger size is requested.
const PLACEHOLDER_SIDE = 16

/** Google's favicon service, used only when the site itself declares nothing usable. */
export const fetchFromGoogle = async (hostname: string, fetch: FetchFn, signal: AbortSignal) => {
  const query = new URLSearchParams({ domain: hostname, sz: String(TARGET_SIZE) })
  const result = await fetchLimited(new URL(`https://www.google.com/s2/favicons?${query}`), {
    fetch,
    accept: 'image/png',
    maxBytes: MAX_BYTES,
    signal,
  })
  if (!result) return null
  const size = pngSize(result.body)
  if (!size || Math.max(size.width, size.height) <= PLACEHOLDER_SIDE) return null
  return result.body
}
