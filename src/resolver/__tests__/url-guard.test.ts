import { describe, expect, it } from 'vite-plus/test'

import {
  hostnameOf,
  isFetchableUrl,
  isHostOrSubdomain,
  isPublicHostname,
  isSameSite,
} from '../url-guard'

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

describe('isHostOrSubdomain', () => {
  it('matches the host itself and its subdomains only', () => {
    expect(isHostOrSubdomain('example.com', 'example.com')).toBe(true)
    expect(isHostOrSubdomain('a.b.example.com', 'example.com')).toBe(true)
    expect(isHostOrSubdomain('notexample.com', 'example.com')).toBe(false)
    expect(isHostOrSubdomain('example.com.evil.example', 'example.com')).toBe(false)
    expect(isHostOrSubdomain('example.com', 'www.example.com')).toBe(false)
  })
})

describe('isSameSite', () => {
  it('accepts the host, its subdomains, and the bare domain for a www. request', () => {
    expect(isSameSite('example.com', 'example.com')).toBe(true)
    expect(isSameSite('example.com', 'www.example.com')).toBe(true)
    expect(isSameSite('example.com', 'docs.example.com')).toBe(true)
    expect(isSameSite('www.example.com', 'example.com')).toBe(true)
  })

  it('refuses other sites and non-www parents', () => {
    expect(isSameSite('team.example.net', 'id.login.example')).toBe(false)
    expect(isSameSite('app.vercel.app', 'vercel.app')).toBe(false)
    expect(isSameSite('docs.example.com', 'example.com')).toBe(false)
    expect(isSameSite('example.com', 'com')).toBe(false)
  })
})

describe('hostnameOf', () => {
  it.each([
    ['github.com', 'github.com'],
    ['GitHub.com.', 'github.com'],
    ['github.com/user/repo', 'github.com'],
    ['https://github.com/user/repo', 'github.com'],
    ['https:/github.com/user', 'github.com'],
    ['http://example.com:80/', 'example.com'],
    ['https://user:pw@example.com/', 'example.com'],
    ['https%3A%2F%2Fexample.com%2F', 'example.com'],
    ['münchen.de', 'xn--mnchen-3ya.de'],
    ['  example.com  ', 'example.com'],
  ])('reads %s as %s', (input, hostname) => expect(hostnameOf(input)).toBe(hostname))

  it.each([
    '',
    'localhost',
    '127.0.0.1',
    'http://[::1]/',
    'file:///etc/passwd',
    'not a host',
    '%E0%A4%A',
  ])('refuses %s', input => expect(hostnameOf(input)).toBeNull())
})
