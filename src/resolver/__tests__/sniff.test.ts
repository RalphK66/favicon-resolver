import { describe, expect, it } from 'vite-plus/test'

import { pngBytes } from './fake-fetch'
import { sniffImage } from '../sniff'

const bytes = (...values: number[]) => new Uint8Array(values)
const text = (value: string) => new TextEncoder().encode(value)

describe('sniffImage', () => {
  it('detects image formats from their bytes', () => {
    expect(sniffImage(pngBytes(64, 64))).toBe('png')
    expect(sniffImage(bytes(0, 0, 1, 0, 1, 0, 16))).toBe('ico')
    expect(sniffImage(text('GIF89a...'))).toBe('gif')
    expect(sniffImage(bytes(0xff, 0xd8, 0xff, 0xe0))).toBe('jpeg')
    expect(sniffImage(text('RIFF\0\0\0\0WEBPVP8 '))).toBe('webp')
    expect(sniffImage(text('\0\0\0 ftypavif\0\0\0\0avifmif1'))).toBe('avif')
    expect(sniffImage(text('\0\0\0 ftypavis\0\0\0\0avifmif1'))).toBe('avif')
    expect(sniffImage(text('\0\0\0 ftypisom\0\0\0\0isom'))).toBeNull()
  })

  it('detects SVG with an XML declaration, DOCTYPE, comments, or a BOM', () => {
    expect(sniffImage(text('<svg xmlns="http://www.w3.org/2000/svg"></svg>'))).toBe('svg')
    expect(sniffImage(text('<?xml version="1.0"?>\n<!-- logo -->\n<svg viewBox="0 0 1 1"/>'))).toBe(
      'svg'
    )
    expect(
      sniffImage(
        text(
          '<?xml version="1.0" standalone="no"?>\n<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd">\n<svg xmlns="http://www.w3.org/2000/svg"/>'
        )
      )
    ).toBe('svg')
    expect(sniffImage(text('\uFEFF  <svg>'))).toBe('svg')
  })

  it('rejects HTML error pages and other content', () => {
    expect(sniffImage(text('<!doctype html><html><body>Not found</body></html>'))).toBeNull()
    expect(sniffImage(text('<html><svg></svg></html>'))).toBeNull()
    expect(sniffImage(text('{"error":true}'))).toBeNull()
    expect(sniffImage(new Uint8Array())).toBeNull()
  })
})
