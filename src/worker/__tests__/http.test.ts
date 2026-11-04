import { describe, expect, it } from 'vite-plus/test'

import { etagOf, iconResponse, isAllowedReferrer, missingResponse } from '../http'

describe('isAllowedReferrer', () => {
  it('allows everything when no list is set', () => {
    expect(isAllowedReferrer('https://anyone.example/', '')).toBe(true)
  })

  it('allows listed hosts and their subdomains, and requests without a Referer', () => {
    const list = 'example.com, localhost'
    expect(isAllowedReferrer('https://example.com/page', list)).toBe(true)
    expect(isAllowedReferrer('https://www.example.com/', list)).toBe(true)
    expect(isAllowedReferrer('http://localhost:8888/', list)).toBe(true)
    expect(isAllowedReferrer(undefined, list)).toBe(true)
    expect(isAllowedReferrer(null, list)).toBe(true)
  })

  it('refuses other sites and look-alikes', () => {
    const list = 'example.com'
    expect(isAllowedReferrer('https://evil.example/', list)).toBe(false)
    expect(isAllowedReferrer('https://notexample.com/', list)).toBe(false)
    expect(isAllowedReferrer('https://example.com.evil.example/', list)).toBe(false)
    expect(isAllowedReferrer('garbage', list)).toBe(false)
  })
})

describe('iconResponse', () => {
  const body = new TextEncoder().encode('<svg/>')

  it('serves the bytes with their type, caching headers, and an ETag', async () => {
    const etag = await etagOf(body)
    const response = iconResponse({ body, type: 'svg', source: 'site', etag })
    expect(response.status).toBe(200)
    expect(response.headers.get('Content-Type')).toBe('image/svg+xml')
    expect(response.headers.get('ETag')).toBe(etag)
    expect(response.headers.get('X-Favicon-Source')).toBe('site')
    expect(response.headers.get('Access-Control-Expose-Headers')).toContain('X-Favicon-Source')
    expect(response.headers.get('Content-Security-Policy')).toContain('sandbox')
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(body)
  })

  it('answers 304 to a matching If-None-Match, weak or strong', async () => {
    const etag = await etagOf(body)
    for (const ifNoneMatch of [etag, `W/${etag}`, `"other", ${etag}`, '*']) {
      const response = iconResponse({ body, type: 'svg', source: 'site', etag, ifNoneMatch })
      expect(response.status).toBe(304)
      expect(response.headers.get('ETag')).toBe(etag)
    }
    const other = iconResponse({ body, type: 'svg', source: 'site', etag, ifNoneMatch: '"x"' })
    expect(other.status).toBe(200)
  })
})

describe('missingResponse', () => {
  it('tells browsers how long to remember the miss', () => {
    expect(missingResponse(404, 'day').headers.get('Cache-Control')).toBe('public, max-age=86400')
    expect(missingResponse(404, 'hour').headers.get('Cache-Control')).toBe('public, max-age=3600')
    expect(missingResponse(403, 'none').headers.get('Cache-Control')).toBe('no-store')
  })
})
