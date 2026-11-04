import { describe, expect, it } from 'vite-plus/test'

import { isFetchableUrl, isPublicHostname } from './url-guard'

describe('isPublicHostname', () => {
  it.each([
    'github.com',
    'www.bbc.co.uk',
    'designsystem.firmglobal.com',
    'xn--bcher-kva.example',
    'a_b.example.com',
  ])('allows %s', hostname => expect(isPublicHostname(hostname)).toBe(true))

  it.each([
    'localhost',
    '127.0.0.1',
    '169.254.169.254',
    '10.0.0.1',
    '0x7f000001',
    '2130706433',
    '[::1]',
    '::1',
    'printer.local',
    'metadata.google.internal',
    'router.lan',
    'nas.home.arpa',
    'GitHub.com',
    'example',
    '-bad.com',
    'a..b.com',
  ])('refuses %s', hostname => expect(isPublicHostname(hostname)).toBe(false))
})

describe('isFetchableUrl', () => {
  it.each(['https://github.com/', 'http://example.com/favicon.ico', 'https://example.com:443/x'])(
    'allows %s',
    url => expect(isFetchableUrl(new URL(url))).toBe(true)
  )

  it.each([
    'http://127.0.0.1/',
    'http://[::1]/',
    'http://0x7f000001/',
    'http://169.254.169.254/latest/meta-data/',
    'http://localhost/',
    'https://example.com:8443/',
    'http://user:pass@example.com/',
    'file:///etc/passwd',
    'ftp://example.com/',
    'gopher://example.com/',
    'data:image/png;base64,AAAA',
  ])('refuses %s', url => expect(isFetchableUrl(new URL(url))).toBe(false))
})
