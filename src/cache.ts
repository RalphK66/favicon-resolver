import { type ResolvedIcon } from './resolver/resolve'
import { type ImageType } from './resolver/sniff'
import { FOUND_TTL_SECONDS, MISSING_TTL_SECONDS } from './http'

/** Bump to ignore everything cached by an older version. */
const KEY_PREFIX = 'icon:v2:'

type Metadata = { type: ImageType | null; source: ResolvedIcon['source'] | null }

export type CachedIcon = { found: true; icon: ResolvedIcon } | { found: false }

export const readCachedIcon = async (kv: KVNamespace, hostname: string) => {
  const { value, metadata } = await kv.getWithMetadata<Metadata>(
    KEY_PREFIX + hostname,
    'arrayBuffer'
  )
  if (value === null || !metadata) return null
  if (!metadata.type || !metadata.source) return { found: false } satisfies CachedIcon
  return {
    found: true,
    icon: { body: new Uint8Array(value), type: metadata.type, source: metadata.source },
  } satisfies CachedIcon
}

/** Stores a found icon for 30 days, or a miss (empty value) for 7, so misses are not re-fetched. */
export const writeCachedIcon = (kv: KVNamespace, hostname: string, icon: ResolvedIcon | null) => {
  const metadata: Metadata = { type: icon?.type ?? null, source: icon?.source ?? null }
  return kv.put(KEY_PREFIX + hostname, icon ? icon.body : new Uint8Array(), {
    expirationTtl: icon ? FOUND_TTL_SECONDS : MISSING_TTL_SECONDS,
    metadata,
  })
}
