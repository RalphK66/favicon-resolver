import { type IconStore } from '../cache'

/** An in-memory `IconStore` for tests. Records every write with its TTL. */
export const fakeKv = () => {
  type Entry = Parameters<IconStore['put']>
  const entries = new Map<string, Entry>()
  const kv: IconStore = {
    getWithMetadata: async key => {
      const entry = entries.get(key)
      if (!entry) return { value: null, metadata: null }
      const value = entry[1]
      return {
        value: value.buffer.slice(
          value.byteOffset,
          value.byteOffset + value.byteLength
        ) as ArrayBuffer,
        metadata: entry[2].metadata,
      }
    },
    put: async (...entry) => {
      entries.set(entry[0], entry)
    },
  }
  return { kv, entries }
}
