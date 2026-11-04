import { describe, expect, it } from 'vite-plus/test'

import { pngSize, sniffImage } from './sniff'

const bytes = (...values: number[]) => new Uint8Array(values)
const text = (value: string) => new TextEncoder().encode(value)

const png = (width: number, height: number) => {
  const data = new Uint8Array(24)
  data.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  const view = new DataView(data.buffer)
  view.setUint32(16, width)
  view.setUint32(20, height)
  return data
}

describe('sniffImage', () => {
  it('detects image formats from their bytes', () => {
    expect(sniffImage(png(64, 64))).toBe('png')
    expect(sniffImage(bytes(0, 0, 1, 0, 1, 0, 16))).toBe('ico')
    expect(sniffImage(text('GIF89a...'))).toBe('gif')
    expect(sniffImage(bytes(0xff, 0xd8, 0xff, 0xe0))).toBe('jpeg')
    expect(sniffImage(text('RIFF\0\0\0\0WEBPVP8 '))).toBe('webp')
  })

  it('detects SVG with an XML declaration, comments, or a BOM', () => {
    expect(sniffImage(text('<svg xmlns="http://www.w3.org/2000/svg"></svg>'))).toBe('svg')
    expect(sniffImage(text('<?xml version="1.0"?>\n<!-- logo -->\n<svg viewBox="0 0 1 1"/>'))).toBe(
      'svg'
    )
    expect(sniffImage(text('\uFEFF  <svg>'))).toBe('svg')
  })

  it('rejects HTML error pages and other content', () => {
    expect(sniffImage(text('<!doctype html><html><body>Not found</body></html>'))).toBeNull()
    expect(sniffImage(text('<html><svg></svg></html>'))).toBeNull()
    expect(sniffImage(text('{"error":true}'))).toBeNull()
    expect(sniffImage(new Uint8Array())).toBeNull()
  })
})

describe('pngSize', () => {
  it('reads width and height from the IHDR chunk', () => {
    expect(pngSize(png(16, 16))).toEqual({ width: 16, height: 16 })
    expect(pngSize(png(180, 120))).toEqual({ width: 180, height: 120 })
  })

  it('returns null for anything else', () => {
    expect(pngSize(text('GIF89a'))).toBeNull()
  })
})
