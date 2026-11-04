export const TARGET_SIZE = 64

export type IconCandidate = {
  url: URL
  /** Lower is better. */
  rank: number
  /** Largest declared side in px; 0 when unknown. */
  size: number
}

type Tag = Record<string, string>

const MAX_LINKS = 40

/** Decodes the few entities that show up in attribute values (`&amp;` in query strings). */
const decodeEntities = (value: string) =>
  value
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')

const parseAttributes = (source: string): Tag => {
  const attributes: Tag = {}
  const pattern = /([^\s"'<>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g
  for (const match of source.matchAll(pattern)) {
    const name = match[1].toLowerCase()
    if (name in attributes) continue
    attributes[name] = decodeEntities(match[2] ?? match[3] ?? match[4] ?? '').trim()
  }
  return attributes
}

type Kind = 'icon' | 'apple' | 'manifest'

const relKind = (rel: string): Kind | 'manifest-link' | null => {
  const tokens = rel.toLowerCase().split(/\s+/)
  if (tokens.includes('icon')) return 'icon'
  if (tokens.includes('apple-touch-icon') || tokens.includes('apple-touch-icon-precomposed')) {
    return 'apple'
  }
  if (tokens.includes('manifest')) return 'manifest-link'
  return null
}

/**
 * Finds `<link>` and `<base>` tags before `</head>`. Comments, scripts, and styles are removed
 * first so icons mentioned inside them are ignored.
 */
export const parseHeadTags = (html: string) => {
  const headEnd = html.search(/<\/head\s*>|<body[\s>]/i)
  const head = (headEnd === -1 ? html : html.slice(0, headEnd))
    .replace(/<!--[\s\S]*?(?:-->|$)/g, '')
    .replace(/<(script|style|noscript|template)\b[\s\S]*?(?:<\/\1\s*>|$)/gi, '')

  const links: Tag[] = []
  let baseHref: string | null = null
  for (const match of head.matchAll(/<(link|base)\b([^>]*)>/gi)) {
    const attributes = parseAttributes(match[2])
    if (match[1].toLowerCase() === 'base') baseHref ??= attributes.href || null
    // Count only icon and manifest links: big sites put dozens of preloads before their icons.
    else if (links.length < MAX_LINKS && relKind(attributes.rel ?? '')) links.push(attributes)
  }
  return { links, baseHref }
}

/** Largest side declared in a `sizes` attribute, `'any'` for scalable icons, or 0 when unknown. */
export const largestSize = (sizes: string): number | 'any' => {
  let largest = 0
  for (const token of sizes.toLowerCase().split(/\s+/)) {
    if (token === 'any') return 'any'
    const match = /^(\d{1,4})x(\d{1,4})$/.exec(token)
    if (match) largest = Math.max(largest, Number(match[1]), Number(match[2]))
  }
  return largest
}

const isSvg = (href: string, type: string) =>
  type.includes('svg') || /\.svgz?(?:$|[?#])/i.test(href) || href.startsWith('data:image/svg')

export const resolveHref = (href: string, base: URL): URL | null => {
  try {
    const url = new URL(href, base)
    return url.protocol === 'https:' || url.protocol === 'http:' || url.protocol === 'data:'
      ? url
      : null
  } catch {
    return null
  }
}

/**
 * Ranks an icon: a raster at or above the target size (smallest first) beats an SVG, which beats
 * apple-touch and manifest icons, then icons without a declared size, then smaller rasters.
 */
export const rankIcon = (props: { href: string; sizes: string; type: string; kind: Kind }) => {
  const { href, sizes, type, kind } = props
  const size = largestSize(sizes)
  if (size === 'any' || isSvg(href, type)) return { rank: 1, size: 0 }
  if (kind === 'apple') return { rank: 2, size: size || 180 }
  if (kind === 'manifest') return size >= TARGET_SIZE ? { rank: 2, size } : { rank: 4, size }
  if (size >= TARGET_SIZE) return { rank: 0, size }
  if (size === 0) return { rank: 3, size: 0 }
  return { rank: 4, size }
}

export const sortCandidates = (candidates: IconCandidate[]) =>
  candidates.toSorted((a, b) => {
    if (a.rank !== b.rank) return a.rank - b.rank
    // At or above the target, prefer the smallest; below it, prefer the largest.
    return a.rank === 4 ? b.size - a.size : a.size - b.size
  })

/** Icon candidates declared by an HTML page, best first, plus the manifest URL when there is one. */
export const iconsFromHtml = (html: string, pageUrl: URL) => {
  const { links, baseHref } = parseHeadTags(html)
  const base = (baseHref && resolveHref(baseHref, pageUrl)) || pageUrl

  const candidates: IconCandidate[] = []
  let manifestUrl: URL | null = null
  for (const link of links) {
    const kind = relKind(link.rel ?? '')
    const href = link.href ?? ''
    if (!kind || !href) continue
    const url = resolveHref(href, base)
    if (!url) continue
    if (kind === 'manifest-link') {
      if (url.protocol !== 'data:') manifestUrl ??= url
      continue
    }
    candidates.push({
      url,
      ...rankIcon({ href, sizes: link.sizes ?? '', type: link.type ?? '', kind }),
    })
  }
  return { candidates: sortCandidates(candidates), manifestUrl }
}

type ManifestIcon = { src: string; sizes: string; type: string; purpose: string }

const asString = (value: unknown, fallback: string) =>
  typeof value === 'string' ? value : fallback

const manifestIcons = (json: unknown): ManifestIcon[] => {
  if (typeof json !== 'object' || json === null || !('icons' in json)) return []
  const { icons } = json
  if (!Array.isArray(icons)) return []
  return icons.slice(0, MAX_LINKS).flatMap((icon: unknown) => {
    if (typeof icon !== 'object' || icon === null || !('src' in icon)) return []
    const entry: Record<string, unknown> = { ...icon }
    if (typeof entry.src !== 'string') return []
    return [
      {
        src: entry.src,
        sizes: asString(entry.sizes, ''),
        type: asString(entry.type, ''),
        purpose: asString(entry.purpose, 'any'),
      },
    ]
  })
}

/** Icon candidates from a web app manifest. Maskable-only icons are skipped (launcher padding). */
export const iconsFromManifest = (text: string, manifestUrl: URL): IconCandidate[] => {
  let json: unknown
  try {
    json = JSON.parse(text)
  } catch {
    return []
  }
  return manifestIcons(json).flatMap(icon => {
    if (!icon.purpose.toLowerCase().split(/\s+/).includes('any')) return []
    const url = resolveHref(icon.src, manifestUrl)
    if (!url) return []
    return [{ url, ...rankIcon({ ...icon, href: icon.src, kind: 'manifest' }) }]
  })
}
