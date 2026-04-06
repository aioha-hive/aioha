// https://developer.mozilla.org/en-US/docs/Web/API/SubtleCrypto/digest#converting_a_digest_to_a_hex_string
export const sha256Bytes = async (message: Uint8Array<ArrayBuffer>): Promise<Uint8Array> => {
  return new Uint8Array(await window.crypto.subtle.digest('SHA-256', message))
}

export const sha256 = async (message: string): Promise<string> => {
  const hashArray = Array.from(await sha256Bytes(new TextEncoder().encode(message)))
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('')
}
