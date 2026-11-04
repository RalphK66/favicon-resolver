import { describe, expect, it } from 'vite-plus/test'

import { cacheKey } from '../cache'
import { fakeKv } from './fake-kv'
import { type ResolveResult } from '../../resolver/resolve'
import { serveIcon, sizeOf } from '../serve'

const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1])
const found: ResolveResult = { icon: { body: png, type: 'png', source: 'site' } }

const serve = (props: {
  path: string
  result?: ResolveResult
  headers?: Record<string, string>
  allowedReferrers?: string
  kv?: ReturnType<typeof fakeKv>
}) => {
  const { path, result = found, headers, allowedReferrers = '', kv = fakeKv() } = props
  const pending: Promise<unknown>[] = []
  const calls: [string, { size: number }][] = []
  const request = new Request(`https://icons.example${path}`, { headers })
  const target = decodeURIComponent(new URL(request.url).pathname.slice(1))
  const response = serveIcon(request, target, {
    kv: kv.kv,
    allowedReferrers,
    waitUntil: task => pending.push(task),
    resolve: async (hostname, options) => {
      calls.push([hostname, options])
      return result
    },
  })
  const settled = async () => {
    const value = await response
    await Promise.all(pending)
    return value
  }
  return { response: settled(), kv, calls }
}

describe('sizeOf', () => {
  it('rounds up to the next allowed size, defaulting to 64', () => {
    expect(sizeOf(null)).toBe(64)
    expect(sizeOf('abc')).toBe(64)
    expect(sizeOf('16')).toBe(16)
    expect(sizeOf('20')).toBe(32)
    expect(sizeOf('64')).toBe(64)
    expect(sizeOf('999')).toBe(256)
  })
})

describe('serveIcon', () => {
  it('serves a resolved icon and caches it', async () => {
    const { response, kv, calls } = serve({ path: '/github.com' })
    const value = await response
    expect(value.status).toBe(200)
    expect(value.headers.get('Content-Type')).toBe('image/png')
    expect(value.headers.get('ETag')).toMatch(/^"[0-9a-f]{64}"$/)
    expect(calls).toEqual([['github.com', { size: 64 }]])
    expect(kv.entries.has(cacheKey('github.com', 64))).toBe(true)
  })

  it('serves from the cache without resolving, and answers 304 to a matching ETag', async () => {
    const first = serve({ path: '/github.com' })
    const etag = (await first.response).headers.get('ETag') ?? ''
    const second = serve({ path: '/github.com', kv: first.kv, headers: { 'If-None-Match': etag } })
    expect((await second.response).status).toBe(304)
    expect(second.calls).toEqual([])
  })

  it('reads the hostname from URLs and paths, and normalises it', async () => {
    for (const path of ['/https://GitHub.com/user/repo', '/github.com/x', '/https:/github.com']) {
      const { calls } = serve({ path })
      await serve({ path }).response
      expect(calls[0]?.[0]).toBe('github.com')
    }
    const { calls } = serve({ path: '/m%C3%BCnchen.de' })
    await serve({ path: '/m%C3%BCnchen.de' }).response
    expect(calls[0]?.[0]).toBe('xn--mnchen-3ya.de')
  })

  it('refuses non-public hostnames with 400', async () => {
    for (const path of ['/localhost', '/127.0.0.1', '/169.254.169.254', '/printer.local', '/']) {
      const { response, calls } = serve({ path })
      expect((await response).status).toBe(400)
      expect(calls).toEqual([])
    }
  })

  it('refuses other referrers with 403 when an allow-list is set', async () => {
    const allowed = serve({
      path: '/github.com',
      allowedReferrers: 'example.com',
      headers: { Referer: 'https://app.example.com/' },
    })
    expect((await allowed.response).status).toBe(200)
    const refused = serve({
      path: '/github.com',
      allowedReferrers: 'example.com',
      headers: { Referer: 'https://other.example/' },
    })
    expect((await refused.response).status).toBe(403)
    expect((await refused.response).headers.get('Cache-Control')).toBe('no-store')
  })

  it('caches a final miss for a day, but not a site that did not answer', async () => {
    const none = serve({ path: '/example.com', result: { icon: null, reason: 'none' } })
    const noneResponse = await none.response
    expect(noneResponse.status).toBe(404)
    expect(noneResponse.headers.get('Cache-Control')).toBe('public, max-age=86400')
    expect(none.kv.entries.has(cacheKey('example.com', 64))).toBe(true)

    const error = serve({ path: '/example.com', result: { icon: null, reason: 'error' } })
    const errorResponse = await error.response
    expect(errorResponse.status).toBe(404)
    expect(errorResponse.headers.get('Cache-Control')).toBe('public, max-age=3600')
    expect(error.kv.entries.size).toBe(0)
  })

  it('serves a cached miss as 404 without resolving', async () => {
    const first = serve({ path: '/example.com', result: { icon: null, reason: 'none' } })
    await first.response
    const second = serve({ path: '/example.com', kv: first.kv })
    expect((await second.response).status).toBe(404)
    expect(second.calls).toEqual([])
  })

  it('passes the requested size through and caches each size separately', async () => {
    const first = serve({ path: '/github.com?size=20' })
    await first.response
    expect(first.calls).toEqual([['github.com', { size: 32 }]])
    const second = serve({ path: '/github.com?size=128', kv: first.kv })
    await second.response
    expect(second.calls).toEqual([['github.com', { size: 128 }]])
    expect([...first.kv.entries.keys()].sort()).toEqual([
      cacheKey('github.com', 128),
      cacheKey('github.com', 32),
    ])
  })
})
