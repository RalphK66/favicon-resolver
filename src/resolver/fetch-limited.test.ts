import { describe, expect, it } from 'vite-plus/test'

import { fakeFetch } from './fake-fetch'
import { fetchLimited } from './fetch-limited'

const options = (fetch: ReturnType<typeof fakeFetch>['fetch'], maxBytes = 1024) => ({
  fetch,
  accept: '*/*',
  maxBytes,
  signal: AbortSignal.timeout(1000),
})

const redirect = (location: string) => ({ status: 302, headers: { location } })

describe('fetchLimited', () => {
  it('follows redirects and reports the final URL', async () => {
    const { fetch } = fakeFetch({
      'http://example.com/': redirect('https://www.example.com/'),
      'https://www.example.com/': { body: 'hello' },
    })
    const result = await fetchLimited(new URL('http://example.com/'), options(fetch))
    expect(result?.url.href).toBe('https://www.example.com/')
    expect(new TextDecoder().decode(result?.body)).toBe('hello')
  })

  it.each([
    'http://127.0.0.1/',
    'http://169.254.169.254/latest/meta-data/',
    'http://[::1]/',
    'http://localhost/',
    'http://metadata.google.internal/',
    'https://example.com:8443/',
    'file:///etc/passwd',
  ])('never requests a redirect to %s', async target => {
    const { fetch, requested } = fakeFetch({ 'https://example.com/': redirect(target) })
    expect(await fetchLimited(new URL('https://example.com/'), options(fetch))).toBeNull()
    expect(requested).toEqual(['https://example.com/'])
  })

  it('gives up after 5 redirects', async () => {
    const routes = Object.fromEntries(
      Array.from({ length: 7 }, (_, index) => [
        `https://example.com/${index}`,
        redirect(`/${index + 1}`),
      ])
    )
    const { fetch, requested } = fakeFetch(routes)
    expect(await fetchLimited(new URL('https://example.com/0'), options(fetch))).toBeNull()
    expect(requested).toHaveLength(6)
  })

  it('refuses bodies over the limit, or truncates them when asked', async () => {
    const { fetch } = fakeFetch({ 'https://example.com/': { body: 'x'.repeat(5000) } })
    expect(await fetchLimited(new URL('https://example.com/'), options(fetch, 100))).toBeNull()
    const truncated = await fetchLimited(new URL('https://example.com/'), {
      ...options(fetch, 100),
      truncate: true,
    })
    expect(truncated?.body.byteLength).toBe(100)
  })

  it('returns error pages when asked, marked as not ok', async () => {
    const { fetch } = fakeFetch({ 'https://example.com/': { status: 401, body: 'login' } })
    const result = await fetchLimited(new URL('https://example.com/'), {
      ...options(fetch),
      allowErrorStatus: true,
    })
    expect(result?.ok).toBe(false)
    expect(new TextDecoder().decode(result?.body)).toBe('login')
  })

  it('returns null for error statuses and network failures', async () => {
    const { fetch } = fakeFetch({ 'https://example.com/': { status: 500, body: 'oops' } })
    expect(await fetchLimited(new URL('https://example.com/'), options(fetch))).toBeNull()
    const failing = async () => Promise.reject(new Error('offline'))
    expect(await fetchLimited(new URL('https://example.com/'), options(failing))).toBeNull()
  })
})
