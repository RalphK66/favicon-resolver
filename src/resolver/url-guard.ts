const DEFAULT_PORTS = new Set(['', '80', '443'])
const BLOCKED_SUFFIXES = ['.local', '.localhost', '.internal', '.intranet', '.lan', '.home.arpa']

// Labels of 1–63 letters, digits, `-` or `_`, at least two labels, a letter in the last one.
const HOSTNAME_PATTERN =
  /^(?=.{1,253}$)(?:[a-z0-9_](?:[a-z0-9_-]{0,61}[a-z0-9])?\.)+[a-z](?:[a-z0-9-]{0,61}[a-z0-9])?$/

/**
 * A public DNS name: lowercase, at least one dot, no IP address, no private-use suffix.
 * IP addresses are refused outright, so a request can never be pointed at 127.0.0.1,
 * 169.254.169.254, or an internal network address written as a number.
 */
export const isPublicHostname = (hostname: string) =>
  HOSTNAME_PATTERN.test(hostname) && !BLOCKED_SUFFIXES.some(suffix => hostname.endsWith(suffix))

/** Plain http(s) on the default port, no credentials, and a public hostname. */
export const isFetchableUrl = (url: URL) =>
  (url.protocol === 'https:' || url.protocol === 'http:') &&
  !url.username &&
  !url.password &&
  DEFAULT_PORTS.has(url.port) &&
  isPublicHostname(url.hostname)

/** True when `host` is `parent` itself or a subdomain of it. */
export const isHostOrSubdomain = (host: string, parent: string) =>
  host === parent || host.endsWith(`.${parent}`)

/**
 * True when `host` belongs to the requested site: the host itself, a subdomain, or the bare domain
 * when `www.` was requested. Any other parent is refused, because on shared platforms it is the
 * platform's own site (`app.vercel.app` → `vercel.app`), whose icon would be the wrong one.
 */
export const isSameSite = (requested: string, host: string) =>
  isHostOrSubdomain(host, requested) || requested === `www.${host}`

/**
 * The public hostname named by a request path: `github.com`, `GitHub.com.`, `github.com/foo`,
 * `https://github.com/foo`, or `münchen.de` (returned as punycode). Null for anything else.
 */
export const hostnameOf = (path: string): string | null => {
  let text = path
  try {
    text = decodeURIComponent(path)
  } catch {
    // Keep the raw text; an invalid escape fails the hostname check below.
  }
  // Catch-all routes collapse `https://` to `https:/`.
  text = text.trim().replace(/^\/+/, '')
  const url = /^https?:\/{1,2}/i.test(text)
    ? text.replace(/^(https?:)\/+/i, '$1//')
    : `https://${text}`
  try {
    const hostname = new URL(url).hostname.replace(/\.$/, '')
    return isPublicHostname(hostname) ? hostname : null
  } catch {
    return null
  }
}
