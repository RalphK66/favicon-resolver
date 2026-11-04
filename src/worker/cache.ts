import { type ResolvedIcon } from '../resolver/resolve'
import { type ImageType } from '../resolver/sniff'
import { FOUND_TTL_SECONDS, MISSING_TTL_SECONDS } from './http'

/** Bump to ignore everything cached by an older version. */
const KEY_PREFIX = 'icon:v3:'

type Metadata = {
  type: ImageType | null
  source: ResolvedIcon['source'] | null
  etag: string | null
}

/** The subset of `KVNamespace` the cache uses, so tests can pass an in-memory stand-in. */
export type IconStore = {
  getWithMetadata: (
    key: string,
    type: 'arrayBuffer'
  ) => Promise<{ value: ArrayBuffer | null; metadata: Metadata | null }>
  put: (
    key: string,
    value: Uint8Array,
    options: { expirationTtl: number; metadata: Metadata }
  ) => Promise<void>
}

export type CachedIcon = { found: true; icon: ResolvedIcon; etag: string } | { found: false }

/** One entry per hostname and requested size. */
export const cacheKey = (hostname: string, size: number) => `${KEY_PREFIX}${size}:${hostname}`

export const readCachedIcon = async (
  kv: IconStore,
  hostname: string,
  size: number
): Promise<CachedIcon | null> => {
  const { value, metadata } = await kv.getWithMetadata(cacheKey(hostname, size), 'arrayBuffer')
  if (value === null || !metadata) return null
  if (!metadata.type || !metadata.source || !metadata.etag) return { found: false }
  return {
    found: true,
    icon: { body: new Uint8Array(value), type: metadata.type, source: metadata.source },
    etag: metadata.etag,
  }
}

/** Stores a found icon for 30 days, or a miss (empty value) for 7, so misses are not re-fetched. */
export const writeCachedIcon = (
  kv: IconStore,
  hostname: string,
  size: number,
  found: { icon: ResolvedIcon; etag: string } | null
) => {
  const metadata: Metadata = {
    type: found?.icon.type ?? null,
    source: found?.icon.source ?? null,
    etag: found?.etag ?? null,
  }
  return kv.put(cacheKey(hostname, size), found ? found.icon.body : new Uint8Array(), {
    expirationTtl: found ? FOUND_TTL_SECONDS : MISSING_TTL_SECONDS,
    metadata,
  })
}
