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
