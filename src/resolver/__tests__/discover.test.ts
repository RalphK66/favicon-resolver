import { describe, expect, it } from 'vite-plus/test'

import { iconsFromHtml, iconsFromManifest, largestSize, parseHeadTags } from '../discover'

const page = new URL('https://example.com/docs/intro')
const hrefs = (html: string, url = page) => iconsFromHtml(html, url).candidates.map(c => c.url.href)

describe('parseHeadTags', () => {
  it('reads attributes in any quoting style and decodes entities', () => {
    const { links } = parseHeadTags(
      `<link rel=icon href=/a.png sizes="32x32"><link REL='apple-touch-icon' HREF="/b.png?x=1&amp;y=2">`
    )
    expect(links).toEqual([
      { rel: 'icon', href: '/a.png', sizes: '32x32' },
      { rel: 'apple-touch-icon', href: '/b.png?x=1&y=2' },
    ])
  })

  it('ignores links in comments, scripts, templates, and the body', () => {
    const { links } = parseHeadTags(`
      <!-- <link rel="icon" href="/commented.png"> -->
      <script>document.write('<link rel="icon" href="/script.png">')</script>
      <template><link rel="icon" href="/template.png"></template>
      <link rel="icon" href="/real.png">
      </head><body><link rel="icon" href="/body.png"></body>`)
    expect(links.map(link => link.href)).toEqual(['/real.png'])
  })

  it('finds icons after many other links (GitHub has dozens of preloads first)', () => {
    const preloads = '<link rel="preload" href="/x.js" as="script">'.repeat(80)
    const { links } = parseHeadTags(`${preloads}<link rel="icon" href="/favicon.svg">`)
    expect(links.map(link => link.href)).toEqual(['/favicon.svg'])
  })

  it('finds <base href>', () => {
    expect(parseHeadTags('<base href="https://cdn.example.net/app/">').baseHref).toBe(
      'https://cdn.example.net/app/'
    )
  })
})

describe('largestSize', () => {
  it('parses sizes attributes', () => {
    expect(largestSize('16x16 32x32 192x192')).toBe(192)
    expect(largestSize('any')).toBe('any')
    expect(largestSize('')).toBe(0)
    expect(largestSize('nonsense')).toBe(0)
  })
})

describe('iconsFromHtml', () => {
  it('resolves relative hrefs against the page URL', () => {
    // The design system case: a page under a path with a ./ relative SVG icon.
    expect(hrefs('<link rel="icon" type="image/svg+xml" href="./favicon.svg">')).toEqual([
      'https://example.com/docs/favicon.svg',
    ])
  })

  it('resolves hrefs against <base href> when present', () => {
    expect(hrefs('<base href="/static/"><link rel="icon" href="icon.png">')).toEqual([
      'https://example.com/static/icon.png',
    ])
  })

  it('prefers a large raster, then SVG, then apple-touch, then unsized, then small', () => {
    const html = `
      <link rel="icon" href="/16.png" sizes="16x16">
      <link rel="shortcut icon" href="/favicon.ico">
      <link rel="apple-touch-icon" href="/apple.png">
      <link rel="icon" href="/logo.svg" type="image/svg+xml">
      <link rel="icon" href="/192.png" sizes="192x192">
      <link rel="icon" href="/96.png" sizes="96x96">
      <link rel="icon" href="/32.png" sizes="32x32">`
    expect(hrefs(html).map(href => new URL(href).pathname)).toEqual([
      '/96.png',
      '/192.png',
      '/logo.svg',
      '/apple.png',
      '/favicon.ico',
      '/32.png',
      '/16.png',
    ])
  })

  it('ranks icons declared for dark colour schemes after the others', () => {
    const html = `
      <link rel="icon" href="/dark.svg" media="(prefers-color-scheme: dark)">
      <link rel="icon" href="/light.svg" media="(prefers-color-scheme: light)">
      <link rel="icon" href="/dark.png" sizes="64x64" media="(prefers-color-scheme: dark)">
      <link rel="icon" href="/any.svg">`
    expect(hrefs(html).map(href => new URL(href).pathname)).toEqual([
      '/dark.png',
      '/light.svg',
      '/any.svg',
      '/dark.svg',
    ])
  })

  it('ranks rasters against the requested size', () => {
    const html = `
      <link rel="icon" href="/16.png" sizes="16x16">
      <link rel="icon" href="/32.png" sizes="32x32">
      <link rel="icon" href="/logo.svg">`
    const paths = (target: number) =>
      iconsFromHtml(html, page, target).candidates.map(c => c.url.pathname)
    expect(paths(16)).toEqual(['/16.png', '/32.png', '/logo.svg'])
    expect(paths(32)).toEqual(['/32.png', '/logo.svg', '/16.png'])
    expect(paths(128)).toEqual(['/logo.svg', '/32.png', '/16.png'])
  })

  it('keeps data: icons and drops javascript: and other schemes', () => {
    const html = `<link rel="icon" href="javascript:alert(1)"><link rel="icon" href="data:image/png;base64,AAAA">`
    expect(hrefs(html)).toEqual(['data:image/png;base64,AAAA'])
  })

  it('returns the manifest URL', () => {
    const { manifestUrl } = iconsFromHtml('<link rel="manifest" href="/site.webmanifest">', page)
    expect(manifestUrl?.href).toBe('https://example.com/site.webmanifest')
  })
})

describe('iconsFromManifest', () => {
  const manifestUrl = new URL('https://example.com/assets/site.webmanifest')

  it('resolves icons against the manifest URL and skips maskable-only icons', () => {
    const manifest = JSON.stringify({
      icons: [
        { src: 'android-192.png', sizes: '192x192', type: 'image/png' },
        { src: 'maskable-512.png', sizes: '512x512', purpose: 'maskable' },
        { src: 'both-512.png', sizes: '512x512', purpose: 'any maskable' },
      ],
    })
    expect(iconsFromManifest(manifest, manifestUrl).map(c => c.url.href)).toEqual([
      'https://example.com/assets/android-192.png',
      'https://example.com/assets/both-512.png',
    ])
  })

  it('tolerates invalid manifests', () => {
    expect(iconsFromManifest('not json', manifestUrl)).toEqual([])
    expect(iconsFromManifest('{"icons":"nope"}', manifestUrl)).toEqual([])
    expect(iconsFromManifest('{"icons":[{"src":5},null]}', manifestUrl)).toEqual([])
  })
})
