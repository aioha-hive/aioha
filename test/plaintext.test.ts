import { describe, it, expect, afterEach, vi } from 'vitest'
import { PrivateKey, PublicKey, Signature, Memo } from '@hiveio/dhive'
import { sha256 } from '@noble/hashes/sha2.js'
import { transactionDigest } from '@aioha/tx-digest'
import { PlaintextKeyProvider } from '../src/providers/custom/plaintext.js'
import { AiohaClient } from '../src/rpc.js'
import { SimpleEventEmitter } from '../src/lib/event-emitter.js'
import { KeyTypes, Providers } from '../src/types.js'
import type { PersistentLoginPlaintext } from '../src/providers/custom/plaintext.js'
import type { HF26Transaction } from '@aioha/types/dist/hive/hf26.js'
import type { LegacyTransaction } from '@aioha/types/dist/hive/legacy.js'

const POSTING_WIF = PrivateKey.fromLogin('alice', 'posting-password', 'posting').toString()
const ACTIVE_WIF = PrivateKey.fromLogin('alice', 'active-password', 'active').toString()
const RECIPIENT_WIF = PrivateKey.fromLogin('recipient', 'posting-password', 'posting').toString()

const voteTxHF26: HF26Transaction = {
  ref_block_num: 23679,
  ref_block_prefix: 291568045,
  expiration: '2025-11-20T07:59:08',
  operations: [
    {
      type: 'vote_operation',
      value: { voter: 'alice', author: 'someone', permlink: 'test-post', weight: 10000 }
    }
  ],
  extensions: []
}

const voteTxLegacy: LegacyTransaction = {
  ref_block_num: 23679,
  ref_block_prefix: 291568045,
  expiration: '2025-11-20T07:59:08',
  operations: [['vote', { voter: 'alice', author: 'someone', permlink: 'test-post', weight: 10000 }]],
  extensions: []
}

const createProvider = (wif?: string) => new PlaintextKeyProvider(wif, new AiohaClient('https://api.test'))

const digestOfMessage = (message: string) => sha256(new TextEncoder().encode(message))

describe('PlaintextKeyProvider', () => {
  it('derives public keys and signs messages verifiable by dhive', async () => {
    const provider = createProvider(POSTING_WIF)
    expect(provider.getPublicKey(POSTING_WIF)).toBe(PrivateKey.from(POSTING_WIF).createPublic().toString())

    const signed = await provider.signMessage('hello', KeyTypes.Posting)
    expect(signed.success).toBe(true)
    if (!signed.success) return
    expect(signed.publicKey).toBe(PrivateKey.from(POSTING_WIF).createPublic().toString())
    expect(
      PublicKey.fromString(signed.publicKey!).verify(Buffer.from(digestOfMessage('hello')), Signature.fromString(signed.result))
    ).toBe(true)
  })

  it('encrypts and decrypts standard Hive memos', async () => {
    const provider = createProvider(POSTING_WIF)
    const recipientPublicKey = PrivateKey.from(RECIPIENT_WIF).createPublic().toString()

    const encrypted = await provider.encryptMemoWithKeys('secret memo', KeyTypes.Posting, [recipientPublicKey])
    expect(encrypted.success).toBe(true)
    if (!encrypted.success) return
    expect(Memo.decode(RECIPIENT_WIF, (encrypted.result as Record<string, string>)[recipientPublicKey])).toBe('#secret memo')

    const decrypted = await provider.decryptMemo(Memo.encode(POSTING_WIF, recipientPublicKey, '#from dhive'), KeyTypes.Posting)
    expect(decrypted.success).toBe(true)
    if (decrypted.success) expect(decrypted.result).toBe('#from dhive')
  })

  it('signs HF26 and legacy transactions', async () => {
    const provider = createProvider(POSTING_WIF)
    const publicKey = PrivateKey.from(POSTING_WIF).createPublic()

    const hf26 = await provider.signTxHF26(voteTxHF26, KeyTypes.Posting)
    expect(hf26.success).toBe(true)
    if (hf26.success) {
      const { digest } = await transactionDigest(voteTxHF26, undefined, sha256)
      expect(publicKey.verify(Buffer.from(digest), Signature.fromString(hf26.result.signatures[0]))).toBe(true)
    }

    const legacy = await provider.signTx(voteTxLegacy, KeyTypes.Posting)
    expect(legacy.success).toBe(true)
    if (legacy.success) expect(legacy.result.signatures).toHaveLength(1)
  })

  it('supports runtime keys per key type and clears them', async () => {
    const provider = createProvider()
    expect(provider.setKey(KeyTypes.Posting, POSTING_WIF)).toBe(PrivateKey.from(POSTING_WIF).createPublic().toString())
    expect(provider.setKey(KeyTypes.Active, ACTIVE_WIF)).toBe(PrivateKey.from(ACTIVE_WIF).createPublic().toString())

    const posting = await provider.signMessage('hello', KeyTypes.Posting)
    const active = await provider.signMessage('hello', KeyTypes.Active)
    expect(posting.success && posting.publicKey).toBe(PrivateKey.from(POSTING_WIF).createPublic().toString())
    expect(active.success && active.publicKey).toBe(PrivateKey.from(ACTIVE_WIF).createPublic().toString())

    provider.clearKeys()
    expect((await provider.signMessage('hello', KeyTypes.Posting)).success).toBe(false)
  })

  it('signs and broadcasts transactions', async () => {
    const fetchMock = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? '{}'))
      if (body.method === 'condenser_api.get_dynamic_global_properties')
        return Response.json({
          result: { head_block_number: 1234, head_block_id: '00'.repeat(20), time: '2025-11-20T07:59:08' }
        })
      return Response.json({ result: {} })
    })
    vi.stubGlobal('fetch', fetchMock)
    try {
      const provider = createProvider(POSTING_WIF)
      const hf26 = await provider.signAndBroadcastTxHF26(
        [
          {
            type: 'vote_operation',
            value: { voter: 'alice', author: 'someone', permlink: 'test-post', weight: 10000 }
          }
        ],
        KeyTypes.Posting
      )
      expect(hf26.success).toBe(true)
      if (hf26.success) expect(hf26.result).toMatch(/^[0-9a-f]{40}$/)

      const legacy = await provider.signAndBroadcastTx(
        [['vote', { voter: 'alice', author: 'someone', permlink: 'test-post', weight: 10000 }]],
        KeyTypes.Posting
      )
      expect(legacy.success).toBe(true)
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('logs in, persists and restores login info', async () => {
    const provider = createProvider(POSTING_WIF)
    expect((await provider.login('alice', { msg: 'Login' })).success).toBe(true)
    expect(provider.getUser()).toBe('alice')
    expect(provider.getLoginInfo()).toEqual({ provider: Providers.Custom, wif: POSTING_WIF, keys: {} })

    const restored = createProvider()
    expect(restored.loadLogin('alice', { provider: Providers.Custom, wif: POSTING_WIF } as PersistentLoginPlaintext)).toBe(true)
    expect(restored.getUser()).toBe('alice')
    expect((await restored.signMessage('hello', KeyTypes.Posting)).success).toBe(true)

    await provider.logout()
    expect(provider.getUser()).toBeUndefined()
  })

  it('persists and restores runtime keys per key type', async () => {
    const provider = createProvider()
    provider.setKey(KeyTypes.Posting, POSTING_WIF)
    provider.setKey(KeyTypes.Active, ACTIVE_WIF)
    expect((await provider.login('alice', { keyType: KeyTypes.Posting })).success).toBe(true)

    const info = provider.getLoginInfo()!
    expect(info.keys).toEqual({ [KeyTypes.Posting]: POSTING_WIF, [KeyTypes.Active]: ACTIVE_WIF })

    const restored = createProvider()
    expect(restored.loadLogin('alice', info)).toBe(true)
    const active = await restored.signMessage('hello', KeyTypes.Active)
    expect(active.success && active.publicKey).toBe(PrivateKey.from(ACTIVE_WIF).createPublic().toString())
  })

  it('fails login when no key is available', async () => {
    const provider = createProvider()
    const login = await provider.login('alice', { msg: 'Login' })
    expect(login.success).toBe(false)
    if (!login.success) {
      expect(login.provider).toBe(Providers.Custom)
      expect(login.errorCode).toBe(5000)
    }
  })
})
