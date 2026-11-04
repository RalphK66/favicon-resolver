import { describe, expect, it } from 'vite-plus/test'

import { fakeFetch, googlePlaceholderPng, pngBytes } from './fake-fetch'
import { resolveFavicon } from '../resolve'

const html = (head: string) => ({
  body: `<!doctype html><html><head>${head}</head><body></body></html>`,
})
const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><circle r="8"/></svg>'
const ico = (...rest: number[]) => new Uint8Array([0, 0, 1, 0, 1, 0, ...rest])
const google = (hostname: string, size = 64) =>
  `https://www.google.com/s2/favicons?domain=${hostname}&sz=${size}`
const redirect = (location: string) => ({ status: 302, headers: { location } })

type Options = Parameters<typeof resolveFavicon>[1]
const icon = async (hostname: string, options: Options) =>
  (await resolveFavicon(hostname, options)).icon

describe('resolveFavicon', () => {
  it('uses the icon the page declares, resolved against the final page URL', async () => {
    const { fetch } = fakeFetch({
      'https://docs.example.com/': redirect('/guide/'),
      'https://docs.example.com/guide/': html(
        '<link rel="icon" type="image/svg+xml" href="./favicon.svg">'
      ),
      'https://docs.example.com/guide/favicon.svg': { body: svg },
    })
    expect(await icon('docs.example.com', { fetch })).toMatchObject({ type: 'svg', source: 'site' })
  })

  it('skips candidates that are not images and tries the next one', async () => {
    const { fetch } = fakeFetch({
      'https://example.com/': html(
        '<link rel="icon" href="/big.png" sizes="192x192"><link rel="icon" href="/small.png" sizes="32x32">'
      ),
      'https://example.com/big.png': { body: '<html>soft 404</html>' },
      'https://example.com/small.png': { body: pngBytes(32, 32) },
    })
    expect(await icon('example.com', { fetch })).toMatchObject({ type: 'png' })
  })

  it('reads the manifest when the page has nothing large', async () => {
    const { fetch, requested } = fakeFetch({
      'https://example.com/': html('<link rel="manifest" href="/app.webmanifest">'),
      'https://example.com/app.webmanifest': {
        body: JSON.stringify({ icons: [{ src: '/icon-192.png', sizes: '192x192' }] }),
      },
      'https://example.com/icon-192.png': { body: pngBytes(192, 192) },
    })
    expect(await icon('example.com', { fetch })).toMatchObject({ source: 'site' })
    expect(requested).toContain('https://example.com/app.webmanifest')
  })

  it('falls back to /favicon.ico when nothing is declared', async () => {
    const { fetch } = fakeFetch({
      'https://example.com/': html(''),
      'https://example.com/favicon.ico': { body: ico(16, 16) },
    })
    expect(await icon('example.com', { fetch })).toMatchObject({ type: 'ico' })
  })

  it('decodes data: URL icons without a request', async () => {
    const { fetch, requested } = fakeFetch({
      'https://example.com/': html(
        `<link rel="icon" href="data:image/svg+xml,${encodeURIComponent(svg)}">`
      ),
    })
    expect(await icon('example.com', { fetch })).toMatchObject({ type: 'svg' })
    expect(requested).toEqual(['https://example.com/'])
  })

  it('tries www. when the bare domain does not answer', async () => {
    const { fetch } = fakeFetch({
      'https://www.example.com/': html('<link rel="icon" href="/i.png">'),
      'https://www.example.com/i.png': { body: pngBytes(48, 48) },
    })
    expect(await icon('example.com', { fetch })).toMatchObject({ source: 'site' })
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

  it('reads icons from the HTML error page /favicon.ico returns (TeamCity behind a login)', async () => {
    const apple = [57, 60, 72, 76, 114, 120, 144, 152, 180]
      .map(
        px => `<link rel="apple-touch-icon" sizes="${px}x${px}" href="/img/icons/apple-${px}.png">`
      )
      .join('')
    const { fetch } = fakeFetch({
      'https://ci.example.com/': { status: 401, body: 'Authentication required' },
      'https://ci.example.com/favicon.ico': {
        status: 404,
        body: `<!DOCTYPE html><html><head><link rel="Shortcut Icon" href="/img/icons/favicon.ico?v10" sizes="16x16 32x32">${apple}</head></html>`,
      },
      // The apple-touch icons it lists are all missing; only the favicon exists.
      'https://ci.example.com/img/icons/favicon.ico?v10': { body: ico(32, 32) },
    })
    expect(await icon('ci.example.com', { fetch })).toMatchObject({ type: 'ico', source: 'site' })
  })

  it('reads icon links from a 401 or 403 home page', async () => {
    const { fetch } = fakeFetch({
      'https://app.example.com/': {
        status: 403,
        body: '<html><head><link rel="icon" href="/brand.svg"></head></html>',
      },
      'https://app.example.com/brand.svg': { body: svg },
    })
    expect(await icon('app.example.com', { fetch })).toMatchObject({ type: 'svg' })
  })

  it('stops trying a kind of icon after two failures', async () => {
    const dead = Array.from(
      { length: 9 },
      (_, index) => `<link rel="apple-touch-icon" href="/a${index}.png">`
    )
    const { fetch, requested } = fakeFetch({
      'https://example.com/': html(
        `${dead.join('')}<link rel="icon" href="/real.png" sizes="16x16">`
      ),
      'https://example.com/real.png': { body: pngBytes(16, 16) },
    })
    expect(await icon('example.com', { fetch })).toMatchObject({ type: 'png' })
    expect(requested.filter(url => /\/a\d\.png$/.test(url))).toHaveLength(2)
  })

  it('does not accept an image served with an error status', async () => {
    const { fetch } = fakeFetch({
      'https://example.com/': html(''),
      'https://example.com/favicon.ico': { status: 404, body: pngBytes(64, 64) },
    })
    expect(await resolveFavicon('example.com', { fetch, siteOnly: true })).toEqual({
      icon: null,
      reason: 'none',
    })
  })

  it('does not serve a /favicon.ico that was cut at the size limit', async () => {
    const huge = new Uint8Array(512 * 1024 + 1)
    huge.set(ico(0, 0))
    const { fetch } = fakeFetch({
      'https://example.com/': html(''),
      'https://example.com/favicon.ico': { body: huge },
    })
    expect(await icon('example.com', { fetch, siteOnly: true })).toBeNull()
  })

  it('accepts an AVIF icon from a CDN that negotiates formats', async () => {
    const avif = new TextEncoder().encode('\0\0\0 ftypavif\0\0\0\0avifmif1')
    const { fetch } = fakeFetch({
      'https://example.com/': html(
        '<link rel="icon" href="https://cdn.example/i.png" sizes="64x64">'
      ),
      'https://cdn.example/i.png': { body: avif },
    })
    expect(await icon('example.com', { fetch })).toMatchObject({ type: 'avif' })
  })

  it("ignores a login page on another site and uses the requested host's /favicon.ico", async () => {
    const { fetch, requested } = fakeFetch({
      'https://team.example.net/': redirect('https://id.login.example/sso'),
      'http://team.example.net/': redirect('https://team.example.net/'),
      'https://www.team.example.net/': { fail: true },
      'https://id.login.example/sso': html('<link rel="icon" href="/login-provider.png">'),
      'https://team.example.net/favicon.ico': { body: ico(48, 48) },
    })
    expect(await icon('team.example.net', { fetch })).toMatchObject({ type: 'ico' })
    expect(requested).not.toContain('https://id.login.example/sso')
    expect(requested).not.toContain('https://id.login.example/login-provider.png')
  })

  it('still tries the other origins after a redirect to another site', async () => {
    const { fetch } = fakeFetch({
      'https://example.com/': redirect('https://login.provider.example/'),
      'https://login.provider.example/': html('<link rel="icon" href="/provider.svg">'),
      'https://www.example.com/': html('<link rel="icon" href="/own.svg">'),
      'https://www.example.com/own.svg': { body: svg },
      'https://login.provider.example/provider.svg': { body: pngBytes(64, 64) },
    })
    expect(await icon('example.com', { fetch })).toMatchObject({ type: 'svg' })
  })

  it('never takes /favicon.ico from another site, as an image or as a page', async () => {
    const asImage = fakeFetch({
      'https://team.example.net/favicon.ico': redirect('https://sso.example/favicon.ico'),
      'https://sso.example/favicon.ico': { body: ico(32, 32) },
    })
    expect(await icon('team.example.net', { fetch: asImage.fetch, siteOnly: true })).toBeNull()
    expect(asImage.requested).not.toContain('https://sso.example/favicon.ico')

    const asPage = fakeFetch({
      'https://team.example.net/favicon.ico': redirect('https://sso.example/login'),
      'https://sso.example/login': html('<link rel="icon" href="/sso.png" sizes="64x64">'),
      'https://sso.example/sso.png': { body: pngBytes(64, 64) },
    })
    expect(await icon('team.example.net', { fetch: asPage.fetch, siteOnly: true })).toBeNull()
    expect(asPage.requested).not.toContain('https://sso.example/sso.png')
  })

  it('still follows redirects within the same site', async () => {
    const { fetch } = fakeFetch({
      'https://example.com/': { status: 301, headers: { location: 'https://www.example.com/' } },
      'https://www.example.com/': html('<link rel="icon" href="/i.svg">'),
      'https://www.example.com/i.svg': { body: svg },
    })
    expect(await icon('example.com', { fetch })).toMatchObject({ type: 'svg' })
  })

  it('does not take a shared platform parent for the same site', async () => {
    const { fetch, requested } = fakeFetch({
      'https://app.platform.example/': redirect('https://platform.example/'),
      'https://platform.example/': html('<link rel="icon" href="/platform.svg">'),
    })
    await resolveFavicon('app.platform.example', { fetch, siteOnly: true })
    expect(requested).not.toContain('https://platform.example/')
  })

  it('prefers the smallest raster at or above the requested size', async () => {
    const { fetch } = fakeFetch({
      'https://example.com/': html(
        '<link rel="icon" href="/16.png" sizes="16x16"><link rel="icon" href="/32.png" sizes="32x32"><link rel="icon" href="/128.png" sizes="128x128">'
      ),
      'https://example.com/16.png': { body: pngBytes(16, 16) },
      'https://example.com/32.png': { body: pngBytes(32, 32) },
      'https://example.com/128.png': { body: pngBytes(128, 128) },
    })
    const sizeOf = async (size: number) => {
      const found = await icon('example.com', { fetch, size })
      return found && new DataView(found.body.buffer).getUint32(16)
    }
    expect(await sizeOf(16)).toBe(16)
    expect(await sizeOf(32)).toBe(32)
    expect(await sizeOf(100)).toBe(128)
  })

  it('falls back to Google, but not to its placeholder globe', async () => {
    const found = fakeFetch({ [google('example.com')]: { body: pngBytes(64, 64) } })
    expect(await icon('example.com', { fetch: found.fetch })).toMatchObject({ source: 'google' })

    const small = fakeFetch({ [google('example.com')]: { body: pngBytes(16, 16) } })
    expect(await icon('example.com', { fetch: small.fetch })).toMatchObject({ source: 'google' })

    const globe = fakeFetch({ [google('example.com')]: { body: googlePlaceholderPng() } })
    expect(await icon('example.com', { fetch: globe.fetch })).toBeNull()

    const sized = fakeFetch({ [google('example.com', 128)]: { body: pngBytes(128, 128) } })
    expect(await icon('example.com', { fetch: sized.fetch, size: 128 })).toMatchObject({
      source: 'google',
    })
  })

  it('reports a miss as final only when the site itself answered', async () => {
    const answered = fakeFetch({ 'https://example.com/': html('') })
    expect(await resolveFavicon('example.com', { fetch: answered.fetch })).toEqual({
      icon: null,
      reason: 'none',
    })

    const offline = fakeFetch({
      'https://example.com/': { fail: true },
      'http://example.com/': { fail: true },
      'https://www.example.com/': { fail: true },
      'https://example.com/favicon.ico': { fail: true },
    })
    expect(await resolveFavicon('example.com', { fetch: offline.fetch })).toEqual({
      icon: null,
      reason: 'error',
    })

    const down = fakeFetch({
      'https://example.com/': { status: 503, body: 'maintenance' },
      'http://example.com/': { status: 503, body: 'maintenance' },
      'https://www.example.com/': { status: 503, body: 'maintenance' },
      'https://example.com/favicon.ico': { status: 503, body: 'maintenance' },
    })
    expect(await resolveFavicon('example.com', { fetch: down.fetch })).toEqual({
      icon: null,
      reason: 'error',
    })
  })
})
