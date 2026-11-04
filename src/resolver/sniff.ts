const IMAGE_TYPES = {
  png: 'image/png',
  ico: 'image/x-icon',
  gif: 'image/gif',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  svg: 'image/svg+xml',
} as const

export type ImageType = keyof typeof IMAGE_TYPES

export const contentTypeOf = (type: ImageType) => IMAGE_TYPES[type]

const startsWith = (data: Uint8Array, bytes: number[], at = 0) =>
  data.length >= at + bytes.length && bytes.every((byte, index) => data[at + index] === byte)

const looksLikeSvg = (data: Uint8Array) => {
  const head = new TextDecoder()
    .decode(data.subarray(0, 1024))
    .replace(/^\uFEFF/, '')
    .trimStart()
  return /^(?:<\?xml[^>]*>\s*)?(?:<!--[\s\S]*?-->\s*)*<svg[\s>]/i.test(head)
}

/**
 * Identifies an image from its bytes, not from the server's Content-Type header (many sites answer
 * a missing icon with an HTML page and status 200). Anything else returns null.
 */
export const sniffImage = (data: Uint8Array): ImageType | null => {
  if (startsWith(data, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'png'
  if (startsWith(data, [0x00, 0x00, 0x01, 0x00]) && data.length > 6) return 'ico'
  if (startsWith(data, [0x47, 0x49, 0x46, 0x38])) return 'gif'
  if (startsWith(data, [0xff, 0xd8, 0xff])) return 'jpeg'
  if (startsWith(data, [0x52, 0x49, 0x46, 0x46]) && startsWith(data, [0x57, 0x45, 0x42, 0x50], 8)) {
    return 'webp'
  }
  if (looksLikeSvg(data)) return 'svg'
  return null
}

/** Width and height from a PNG's IHDR chunk. */
export const pngSize = (data: Uint8Array) => {
  if (sniffImage(data) !== 'png' || data.length < 24) return null
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength)
  return { width: view.getUint32(16), height: view.getUint32(20) }
}
