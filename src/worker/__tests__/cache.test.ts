import { describe, expect, it } from 'vite-plus/test'

import { cacheKey, readCachedIcon, writeCachedIcon } from '../cache'
import { fakeKv } from './fake-kv'
import { FOUND_TTL_SECONDS, MISSING_TTL_SECONDS } from '../http'

const icon = { body: new Uint8Array([1, 2, 3]), type: 'png', source: 'site' } as const

describe('icon cache', () => {
  it('stores a found icon with its type, source, and ETag for 30 days', async () => {
    const { kv, entries } = fakeKv()
    await writeCachedIcon(kv, 'example.com', 64, { icon, etag: '"abc"' })
    expect(entries.get(cacheKey('example.com', 64))?.[2].expirationTtl).toBe(FOUND_TTL_SECONDS)
    expect(await readCachedIcon(kv, 'example.com', 64)).toEqual({
      found: true,
      icon,
      etag: '"abc"',
    })
  })

  it('stores a miss for 7 days', async () => {
    const { kv, entries } = fakeKv()
    await writeCachedIcon(kv, 'example.com', 64, null)
    expect(entries.get(cacheKey('example.com', 64))?.[2].expirationTtl).toBe(MISSING_TTL_SECONDS)
    expect(await readCachedIcon(kv, 'example.com', 64)).toEqual({ found: false })
  })

  it('keeps sizes apart and returns null for unknown hosts', async () => {
    const { kv } = fakeKv()
    await writeCachedIcon(kv, 'example.com', 64, { icon, etag: '"abc"' })
    expect(await readCachedIcon(kv, 'example.com', 32)).toBeNull()
    expect(await readCachedIcon(kv, 'other.example', 64)).toBeNull()
  })
})
