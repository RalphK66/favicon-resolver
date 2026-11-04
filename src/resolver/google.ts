import { type FetchFn, fetchLimited } from './fetch-limited'
import { sha256Hex } from './hash'
import { sniffImage } from './sniff'

const MAX_BYTES = 256 * 1024
/**
 * SHA-256 of the 16×16 globe Google serves when it has no icon. It comes with a 404, which
 * `fetchLimited` already refuses; the hash catches it should that ever change. Real 16px icons
 * (status 200) are accepted.
 */
const PLACEHOLDER_SHA256 = '59bfe9bc385ad69f50793ce4a53397316d7a875a7148a63c16df9b674c6cda64'

/** Google's favicon service, used only when the site itself declares nothing usable. */
export const fetchFromGoogle = async (
  hostname: string,
  size: number,
  fetch: FetchFn,
  signal: AbortSignal
) => {
  const query = new URLSearchParams({ domain: hostname, sz: String(size) })
  const result = await fetchLimited(new URL(`https://www.google.com/s2/favicons?${query}`), {
    fetch,
    accept: 'image/png',
    maxBytes: MAX_BYTES,
    signal,
  })
  if (!result || sniffImage(result.body) !== 'png') return null
  if ((await sha256Hex(result.body)) === PLACEHOLDER_SHA256) return null
  return result.body
}
