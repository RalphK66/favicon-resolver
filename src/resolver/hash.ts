/** Hex SHA-256 of some bytes. Used for ETags and to recognise Google's placeholder. */
export const sha256Hex = async (data: Uint8Array) => {
  const digest = await crypto.subtle.digest('SHA-256', data as BufferSource)
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')
}
