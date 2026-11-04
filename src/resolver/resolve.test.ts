import { describe, expect, it } from 'vite-plus/test'

import { fakeFetch, pngBytes } from './fake-fetch'
import { resolveFavicon } from './resolve'

const html = (head: string) => ({
  body: `<!doctype html><html><head>${head}</head><body></body></html>`,
})
const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><circle r="8"/></svg>'
const google = (hostname: string) => `https://www.google.com/s2/favicons?domain=${hostname}&sz=64`

describe('resolveFavicon', () => {
  it('uses the icon the page declares, resolved against the final page URL', async () => {
    const { fetch } = fakeFetch({
      'https://docs.example.com/': { status: 302, headers: { location: '/guide/' } },
      'https://docs.example.com/guide/': html(
        '<link rel="icon" type="image/svg+xml" href="./favicon.svg">'
      ),
      'https://docs.example.com/guide/favicon.svg': { body: svg },
    })
    const icon = await resolveFavicon('docs.example.com', { fetch })
    expect(icon).toMatchObject({ type: 'svg', source: 'site' })
  })

  it('skips candidates that are not images and tries the next one', async () => {
    const { fetch } = fakeFetch({
      'https://example.com/': html(
        '<link rel="icon" href="/big.png" sizes="192x192"><link rel="icon" href="/small.png" sizes="32x32">'
      ),
      'https://example.com/big.png': { body: '<html>soft 404</html>' },
      'https://example.com/small.png': { body: pngBytes(32, 32) },
    })
    expect(await resolveFavicon('example.com', { fetch })).toMatchObject({ type: 'png' })
  })

  it('reads the manifest when the page has nothing large', async () => {
    const { fetch, requested } = fakeFetch({
      'https://example.com/': html('<link rel="manifest" href="/app.webmanifest">'),
      'https://example.com/app.webmanifest': {
        body: JSON.stringify({ icons: [{ src: '/icon-192.png', sizes: '192x192' }] }),
      },
      'https://example.com/icon-192.png': { body: pngBytes(192, 192) },
    })
    expect(await resolveFavicon('example.com', { fetch })).toMatchObject({ source: 'site' })
    expect(requested).toContain('https://example.com/app.webmanifest')
  })

  it('falls back to /favicon.ico when nothing is declared', async () => {
    const { fetch } = fakeFetch({
      'https://example.com/': html(''),
      'https://example.com/favicon.ico': { body: new Uint8Array([0, 0, 1, 0, 1, 0, 16, 16]) },
    })
    expect(await resolveFavicon('example.com', { fetch })).toMatchObject({ type: 'ico' })
  })

  it('decodes data: URL icons without a request', async () => {
    const { fetch, requested } = fakeFetch({
      'https://example.com/': html(
        `<link rel="icon" href="data:image/svg+xml,${encodeURIComponent(svg)}">`
      ),
    })
    expect(await resolveFavicon('example.com', { fetch })).toMatchObject({ type: 'svg' })
    expect(requested).toEqual(['https://example.com/'])
  })

  it('tries www. when the bare domain does not answer', async () => {
    const { fetch } = fakeFetch({
      'https://www.example.com/': html('<link rel="icon" href="/i.png">'),
      'https://www.example.com/i.png': { body: pngBytes(48, 48) },
    })
    expect(await resolveFavicon('example.com', { fetch })).toMatchObject({ source: 'site' })
  })

  it('never follows an icon link to an internal address', async () => {
    const { fetch, requested } = fakeFetch({
      'https://example.com/': html(
        '<link rel="icon" href="http://169.254.169.254/latest/meta-data/"><link rel="icon" href="http://10.0.0.1/x.png">'
      ),
    })
    await resolveFavicon('example.com', { fetch, siteOnly: true })
    expect(requested.some(url => /169\.254|10\.0\.0\.1/.test(url))).toBe(false)
  })

  it('falls back to Google, but not to its 16px placeholder', async () => {
    const found = fakeFetch({ [google('example.com')]: { body: pngBytes(64, 64) } })
    expect(await resolveFavicon('example.com', { fetch: found.fetch })).toMatchObject({
      source: 'google',
    })

    const placeholder = fakeFetch({ [google('example.com')]: { body: pngBytes(16, 16) } })
    expect(await resolveFavicon('example.com', { fetch: placeholder.fetch })).toBeNull()
  })
})
