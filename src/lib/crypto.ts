import { secp256k1 } from '@noble/curves/secp256k1'
import { ripemd160 } from '@noble/hashes/legacy.js'
import { sha256, sha512 } from '@noble/hashes/sha2.js'

/**
 * Self-contained crypto helpers used by the plaintext and Google Drive providers.
 *
 * These helpers implement the Hive key, signature and memo formats plus the
 * ECDH wallet encryption format used by @hiveio/wax-signers-external, without
 * pulling in dhive or beekeeper. This keeps the providers usable in browsers
 * (dhive/beekeeper require a Buffer or WASM runtime).
 */

const BASE58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'
const BASE58_MAP = new Map<string, number>([...BASE58_ALPHABET].map((c, i) => [c, i]))

const textEncoder = new TextEncoder()
const textDecoder = new TextDecoder()

export const toHex = (bytes: Uint8Array): string =>
  Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')

const concatBytes = (...arrays: Uint8Array[]): Uint8Array => {
  const length = arrays.reduce((size, array) => size + array.length, 0)
  const result = new Uint8Array(length)
  let offset = 0
  for (const array of arrays) {
    result.set(array, offset)
    offset += array.length
  }
  return result
}

const bytesEqual = (a: Uint8Array, b: Uint8Array): boolean => {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false
  return true
}

export const base58Encode = (bytes: Uint8Array): string => {
  let zeros = 0
  while (zeros < bytes.length && bytes[zeros] === 0) zeros++
  const digits: number[] = []
  for (const byte of bytes) {
    let carry = byte
    for (let i = 0; i < digits.length; i++) {
      carry += digits[i] << 8
      digits[i] = carry % 58
      carry = (carry / 58) | 0
    }
    while (carry > 0) {
      digits.push(carry % 58)
      carry = (carry / 58) | 0
    }
  }
  let result = '1'.repeat(zeros)
  for (let i = digits.length - 1; i >= 0; i--) result += BASE58_ALPHABET[digits[i]]
  return result
}

export const base58Decode = (encoded: string): Uint8Array => {
  const bytes: number[] = []
  for (const char of encoded) {
    let carry = BASE58_MAP.get(char)
    if (carry === undefined) throw new Error(`Invalid base58 character '${char}'`)
    for (let i = 0; i < bytes.length; i++) {
      carry += bytes[i] * 58
      bytes[i] = carry & 0xff
      carry >>= 8
    }
    while (carry > 0) {
      bytes.push(carry & 0xff)
      carry >>= 8
    }
  }
  let zeros = 0
  while (zeros < encoded.length && encoded[zeros] === '1') zeros++
  const result = new Uint8Array(bytes.length + zeros)
  result.set(bytes.reverse(), zeros)
  return result
}

const uint64LE = (value: bigint): Uint8Array => {
  const result = new Uint8Array(8)
  let remaining = value
  for (let i = 0; i < 8; i++) {
    result[i] = Number(remaining & BigInt(0xff))
    remaining >>= BigInt(8)
  }
  return result
}

const uint32LE = (value: number): Uint8Array =>
  Uint8Array.from([value & 0xff, (value >>> 8) & 0xff, (value >>> 16) & 0xff, (value >>> 24) & 0xff])

const readUint64LE = (data: Uint8Array, offset: number): bigint => {
  let result = BigInt(0)
  for (let i = 0; i < 8; i++) result |= BigInt(data[offset + i]) << BigInt(8 * i)
  return result
}

const readUint32LE = (data: Uint8Array, offset: number): number =>
  (data[offset] | (data[offset + 1] << 8) | (data[offset + 2] << 16) | (data[offset + 3] << 24)) >>> 0

/** LEB128 (protobuf-style) varint encoding, used by Hive memo and beekeeper wallet formats. */
const writeVarint = (value: number): Uint8Array => {
  const bytes: number[] = []
  let remaining = value
  while (remaining >= 0x80) {
    bytes.push((remaining & 0x7f) | 0x80)
    remaining >>>= 7
  }
  bytes.push(remaining)
  return Uint8Array.from(bytes)
}

/** Reads a LEB128 varint, returning the value and the next offset. */
const readVarint = (data: Uint8Array, offset: number): [number, number] => {
  let value = 0
  let shift = 0
  for (;;) {
    if (offset >= data.length) throw new Error('unexpected end of data')
    const byte = data[offset++]
    value |= (byte & 0x7f) << shift
    if (!(byte & 0x80)) break
    shift += 7
    if (shift >= 35) throw new Error('varint overflow')
  }
  return [value >>> 0, offset]
}

const getSubtle = (): SubtleCrypto => {
  if (!globalThis.crypto?.subtle) throw new Error('Web Crypto API is not available in this environment')
  return globalThis.crypto.subtle
}

const randomBytes = (length: number): Uint8Array => {
  if (!globalThis.crypto?.getRandomValues) throw new Error('Web Crypto API is not available in this environment')
  return globalThis.crypto.getRandomValues(new Uint8Array(length))
}

const randomUint64 = (): bigint => {
  let result = BigInt(0)
  const bytes = randomBytes(8)
  for (let i = 0; i < 8; i++) result |= BigInt(bytes[i]) << BigInt(8 * i)
  return result
}

const aesCbcEncrypt = async (key: Uint8Array, iv: Uint8Array, data: Uint8Array): Promise<Uint8Array> => {
  const cryptoKey = await getSubtle().importKey('raw', key as BufferSource, 'AES-CBC', false, ['encrypt'])
  return new Uint8Array(await getSubtle().encrypt({ name: 'AES-CBC', iv: iv as BufferSource }, cryptoKey, data as BufferSource))
}

const aesCbcDecrypt = async (key: Uint8Array, iv: Uint8Array, data: Uint8Array): Promise<Uint8Array> => {
  const cryptoKey = await getSubtle().importKey('raw', key as BufferSource, 'AES-CBC', false, ['decrypt'])
  return new Uint8Array(await getSubtle().decrypt({ name: 'AES-CBC', iv: iv as BufferSource }, cryptoKey, data as BufferSource))
}

/** Parses a Hive WIF private key into its 32-byte scalar. */
export const privateKeyFromWif = (wif: string): Uint8Array => {
  const decoded = base58Decode(wif)
  if (decoded.length !== 37 || decoded[0] !== 0x80) throw new Error('invalid private key WIF')
  const payload = decoded.subarray(0, 33)
  const checksum = decoded.subarray(33)
  if (!bytesEqual(checksum, sha256(sha256(payload)).subarray(0, 4))) throw new Error('invalid private key WIF checksum')
  return payload.subarray(1)
}

/** Encodes a 32-byte private key scalar into a Hive WIF string. */
export const privateKeyToWif = (privateKey: Uint8Array): string => {
  if (privateKey.length !== 32) throw new Error('private key must be 32 bytes')
  const payload = concatBytes(Uint8Array.of(0x80), privateKey)
  return base58Encode(concatBytes(payload, sha256(sha256(payload)).subarray(0, 4)))
}

/** Parses a Hive public key (STM-prefixed) into its 33-byte compressed form. */
export const publicKeyFromString = (publicKey: string): Uint8Array => {
  if (!publicKey.startsWith('STM')) throw new Error('invalid public key prefix')
  const decoded = base58Decode(publicKey.slice(3))
  if (decoded.length !== 37) throw new Error('invalid public key length')
  const payload = decoded.subarray(0, 33)
  if (!bytesEqual(decoded.subarray(33), ripemd160(payload).subarray(0, 4))) throw new Error('invalid public key checksum')
  return payload
}

/** Formats a 33-byte compressed public key as a STM-prefixed Hive public key. */
export const publicKeyToString = (publicKey: Uint8Array): string =>
  'STM' + base58Encode(concatBytes(publicKey, ripemd160(publicKey).subarray(0, 4)))

/** Derives the public key for a WIF private key. */
export const getPublicKeyFromWif = (wif: string): string =>
  publicKeyToString(secp256k1.getPublicKey(privateKeyFromWif(wif), true))

/**
 * Derives the wallet encryption key from a password.
 * Matches wax's `getPrivateKeyFromPassword('dummyaccount', 'posting', password)`.
 */
export const deriveWalletEncryptionKey = (password: string): string =>
  privateKeyToWif(sha256(textEncoder.encode('dummyaccountposting' + password)))

const sharedSecret = (privateKey: Uint8Array, publicKey: Uint8Array): Uint8Array =>
  sha512(secp256k1.getSharedSecret(privateKey, publicKey, true).subarray(1, 33))

const encryptionKeyFromNonce = (nonce: bigint, secret: Uint8Array): Uint8Array =>
  sha512(concatBytes(uint64LE(nonce), secret))

/** Returns a random 64-bit nonce for wallet/memo encryption. */
export const generateNonce = (): bigint => randomUint64()

/**
 * Encrypts data using the ECDH format of @hiveio/wax-signers-external (and beekeeper's
 * `encryptData`). The wallet file written by this function can be read by beekeeper and
 * vice versa.
 *
 * @param content Plaintext wallet data
 * @param encryptionKeyWif WIF of the key used to encrypt (encrypted to itself)
 * @param nonce Optional nonce, primarily useful for deterministic tests
 */
export const encryptWalletData = async (
  content: string,
  encryptionKeyWif: string,
  nonce: bigint = generateNonce()
): Promise<string> => {
  const privateKey = privateKeyFromWif(encryptionKeyWif)
  const publicKey = secp256k1.getPublicKey(privateKey, true)
  const key = encryptionKeyFromNonce(nonce, sharedSecret(privateKey, publicKey))
  const check = sha256(key).subarray(0, 4)
  const plaintext = textEncoder.encode(content)
  const ciphertext = await aesCbcEncrypt(
    key.subarray(0, 32),
    key.subarray(32, 48),
    concatBytes(writeVarint(plaintext.length), plaintext)
  )
  return base58Encode(concatBytes(uint64LE(nonce), check, writeVarint(ciphertext.length), ciphertext))
}

/** Decrypts data encrypted with {@link encryptWalletData}. */
export const decryptWalletData = async (encrypted: string, encryptionKeyWif: string): Promise<string> => {
  const packed = base58Decode(encrypted)
  if (packed.length < 13) throw new Error('wallet data is truncated')
  const nonce = readUint64LE(packed, 0)
  const check = packed.subarray(8, 12)
  const [length, offset] = readVarint(packed, 12)
  if (offset + length > packed.length) throw new Error('wallet data is truncated')
  const privateKey = privateKeyFromWif(encryptionKeyWif)
  const publicKey = secp256k1.getPublicKey(privateKey, true)
  const key = encryptionKeyFromNonce(nonce, sharedSecret(privateKey, publicKey))
  if (!bytesEqual(check, sha256(key).subarray(0, 4))) throw new Error('invalid password or corrupted wallet data')
  const plaintext = await aesCbcDecrypt(key.subarray(0, 32), key.subarray(32, 48), packed.subarray(offset, offset + length))
  const [contentLength, contentOffset] = readVarint(plaintext, 0)
  if (contentOffset + contentLength > plaintext.length) throw new Error('wallet data is corrupted')
  return textDecoder.decode(plaintext.subarray(contentOffset, contentOffset + contentLength))
}

/**
 * Encrypts a Hive memo using the standard Hive memo format (compatible with
 * Keychain, dhive and other Hive wallets).
 *
 * @param message Plaintext memo without the leading '#'
 * @param senderWif Sender's private memo/posting/active key
 * @param recipientPublicKey Recipient's public key for the same role
 * @param nonce Optional nonce, primarily useful for deterministic tests
 */
export const encryptMemo = async (
  message: string,
  senderWif: string,
  recipientPublicKey: string,
  nonce: bigint = generateNonce()
): Promise<string> => {
  const senderPrivateKey = privateKeyFromWif(senderWif)
  const senderPublicKey = secp256k1.getPublicKey(senderPrivateKey, true)
  const recipientKey = publicKeyFromString(recipientPublicKey)
  const key = encryptionKeyFromNonce(nonce, sharedSecret(senderPrivateKey, recipientKey))
  const check = readUint32LE(sha256(key), 0)
  const plaintext = textEncoder.encode(message)
  const ciphertext = await aesCbcEncrypt(
    key.subarray(0, 32),
    key.subarray(32, 48),
    concatBytes(writeVarint(plaintext.length), plaintext)
  )
  return (
    '#' +
    base58Encode(
      concatBytes(
        senderPublicKey,
        recipientKey,
        uint64LE(nonce),
        uint32LE(check),
        writeVarint(ciphertext.length),
        ciphertext
      )
    )
  )
}

/** Decrypts a Hive memo encrypted with the standard Hive memo format. */
export const decryptMemo = async (memo: string, recipientWif: string): Promise<string> => {
  if (!memo.startsWith('#')) throw new Error('encrypted memo must start with #')
  const packed = base58Decode(memo.slice(1))
  if (packed.length < 79) throw new Error('memo is truncated')
  const from = packed.subarray(0, 33)
  const to = packed.subarray(33, 66)
  const nonce = readUint64LE(packed, 66)
  const check = readUint32LE(packed, 74)
  const [length, offset] = readVarint(packed, 78)
  if (offset + length > packed.length) throw new Error('memo is truncated')
  const privateKey = privateKeyFromWif(recipientWif)
  const ownPublicKey = secp256k1.getPublicKey(privateKey, true)
  const otherPublicKey = bytesEqual(ownPublicKey, from) ? to : from
  const key = encryptionKeyFromNonce(nonce, sharedSecret(privateKey, otherPublicKey))
  if (check !== readUint32LE(sha256(key), 0)) throw new Error('invalid memo encryption key')
  const plaintext = await aesCbcDecrypt(key.subarray(0, 32), key.subarray(32, 48), packed.subarray(offset, offset + length))
  try {
    const [contentLength, contentOffset] = readVarint(plaintext, 0)
    if (contentOffset + contentLength <= plaintext.length)
      return '#' + textDecoder.decode(plaintext.subarray(contentOffset, contentOffset + contentLength))
  } catch {}
  // Sender did not length-prefix the memo
  return '#' + textDecoder.decode(plaintext)
}

const isCanonicalSignature = (signature: Uint8Array): boolean =>
  !(signature[0] & 0x80) &&
  !(signature[0] === 0 && !(signature[1] & 0x80)) &&
  !(signature[32] & 0x80) &&
  !(signature[32] === 0 && !(signature[33] & 0x80))

/**
 * Signs a 32-byte digest and returns the 65-byte Hive signature string.
 * Retries with extra deterministic entropy until the signature is canonical,
 * matching the requirement enforced by Hive nodes.
 */
export const signDigest = (digest: Uint8Array, privateKeyWif: string): string => {
  const privateKey = privateKeyFromWif(privateKeyWif)
  for (let attempt = 0; attempt < 256; attempt++) {
    const extraEntropy = attempt === 0 ? undefined : sha256(concatBytes(digest, writeVarint(attempt)))
    const signature = secp256k1.sign(digest, privateKey, { lowS: true, extraEntropy })
    if (signature.recovery > 1) continue
    const compact = signature.toCompactRawBytes()
    if (!isCanonicalSignature(compact)) continue
    const result = new Uint8Array(65)
    result[0] = 31 + signature.recovery
    result.set(compact, 1)
    return toHex(result)
  }
  throw new Error('failed to produce a canonical signature')
}

/** Returns the SHA-256 digest of a UTF-8 message. */
export const messageDigest = (message: string): Uint8Array => sha256(textEncoder.encode(message))
