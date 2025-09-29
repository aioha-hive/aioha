import { md5 } from 'js-md5'

const HEAD_SIZE_DWORD = 2
const SALT_SIZE_DWORD = 2

function concatUint8Arrays(...as: Uint8Array[]) {
  const size = as.reduce((size, a) => size + a.length, 0)
  const c = new Uint8Array(size)
  let i = 0
  for (const a of as) {
    c.set(a, i)
    i += a.length
  }
  return c
}

function splitUint8Array(a: Uint8Array<ArrayBuffer>, i: number) {
  return [a.subarray(0, i), a.subarray(i, a.length)]
}

const base64ToUint8Array = (base64String: string) => Uint8Array.from(atob(base64String), (c) => c.charCodeAt(0))

export async function aesDecrypt(cryptoJSCipherBase64: string, password: string) {
  const { salt, ciphertext } = parseCryptoJSCipherBase64(cryptoJSCipherBase64)
  const { key, iv } = await dangerouslyDeriveParameters(password, salt!, 8, 4, 1)
  const plaintextArrayBuffer = await window.crypto.subtle.decrypt({ name: 'AES-CBC', iv }, key, ciphertext)
  return new TextDecoder().decode(plaintextArrayBuffer)
}

export async function aesEncrypt(plaintext: string, password: string) {
  const salt = window.crypto.getRandomValues(new Uint8Array(8))
  const { key, iv } = await dangerouslyDeriveParameters(password, salt!, 8, 4, 1)
  const ciphertextArrayBuffer = await window.crypto.subtle.encrypt(
    { name: 'AES-CBC', iv },
    key,
    new TextEncoder().encode(plaintext)
  )

  const combinedBuffer = new Uint8Array(8 + salt.length + ciphertextArrayBuffer.byteLength)
  combinedBuffer.set(new TextEncoder().encode('Salted__'), 0)
  combinedBuffer.set(salt, 8)
  combinedBuffer.set(new Uint8Array(ciphertextArrayBuffer), 8 + salt.length)

  // Return base64 encoded result
  return btoa(String.fromCharCode(...combinedBuffer))
}

function parseCryptoJSCipherBase64(cryptoJSCipherBase64: string) {
  let salt
  let ciphertext = base64ToUint8Array(cryptoJSCipherBase64)
  const [head, body] = splitUint8Array(ciphertext, HEAD_SIZE_DWORD * 4)

  // This effectively checks if the ciphertext starts with 'Salted__'.
  // Alternatively we could do `atob(cryptoJSCipherBase64.substr(0, 11)) === "Salted__"`.
  const headDataView = new DataView(head.buffer)
  if (headDataView.getInt32(0) === 0x53616c74 && headDataView.getInt32(4) === 0x65645f5f) {
    ;[salt, ciphertext] = splitUint8Array(body, SALT_SIZE_DWORD * 4)
  }

  return { ciphertext, salt }
}

async function dangerouslyDeriveParameters(
  password: string,
  salt: Uint8Array,
  keySizeDWORD: number,
  ivSizeDWORD: number,
  iterations: number
) {
  const passwordUint8Array = new TextEncoder().encode(password)
  const keyPlusIV = dangerousEVPKDF(passwordUint8Array, salt, keySizeDWORD + ivSizeDWORD, iterations)
  const [rawKey, iv] = splitUint8Array(keyPlusIV, keySizeDWORD * 4)
  const key = await window.crypto.subtle.importKey('raw', rawKey, 'AES-CBC', false, ['encrypt', 'decrypt'])
  return { key, iv }
}

function dangerousEVPKDF(passwordUint8Array: Uint8Array, saltUint8Array: Uint8Array, keySizeDWORD: number, iterations: number) {
  let derivedKey = new Uint8Array()
  let b1: ArrayBuffer
  let block = new Uint8Array()

  while (derivedKey.byteLength < keySizeDWORD * 4) {
    b1 = md5.arrayBuffer(concatUint8Arrays(block, passwordUint8Array, saltUint8Array))

    for (let i = 1; i < iterations; i++) {
      b1 = md5.arrayBuffer(block)
    }

    block = new Uint8Array(b1)
    derivedKey = concatUint8Arrays(derivedKey, block)
  }

  return derivedKey
}
