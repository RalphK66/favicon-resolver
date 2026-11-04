import { describe, expect, it } from 'vite-plus/test'

import { isAllowedReferrer } from './http'

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
  })

  it('refuses other sites and look-alikes', () => {
    const list = 'example.com'
    expect(isAllowedReferrer('https://evil.example/', list)).toBe(false)
    expect(isAllowedReferrer('https://notexample.com/', list)).toBe(false)
    expect(isAllowedReferrer('https://example.com.evil.example/', list)).toBe(false)
  })
})
