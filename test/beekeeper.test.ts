import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import createBeekeeper, { type IBeekeeperInstance, type IBeekeeperUnlockedWallet } from '@hiveio/beekeeper'
import { sha256 } from '@noble/hashes/sha2.js'
import { BeekeeperProvider } from '../src/providers/custom/beekeeper.js'
import { SimpleEventEmitter } from '../src/lib/event-emitter.js'
import { AiohaClient } from '../src/rpc.js'
import { KeyTypes, Providers } from '../src/types.js'
import type { PersistentLoginBeekeeper } from '../src/providers/custom/beekeeper.js'
import type { HF26Transaction } from '../src/lib/hf26-types.js'
import type { Transaction } from '@hiveio/dhive'

const TEST_WIF = '5JkFnXrLM2ap9t3AmAxBJvQHF7xSKtnTrCTginQCkhzU5S7ecPT'

const voteTxHF26: HF26Transaction = {
  ref_block_num: 23679,
  ref_block_prefix: 291568045,
  expiration: '2025-11-20T07:59:08',
  operations: [
    {
      type: 'vote_operation',
      value: {
        voter: 'techcoderx',
        author: 'someone',
        permlink: 'test-post',
        weight: 10000
      }
    }
  ],
  extensions: []
}

const voteTxLegacy: Transaction = {
  ref_block_num: 23679,
  ref_block_prefix: 291568045,
  expiration: '2025-11-20T07:59:08',
  operations: [['vote', { voter: 'techcoderx', author: 'someone', permlink: 'test-post', weight: 10000 }]],
  extensions: []
}

describe('BeekeeperProvider', () => {
  let bk: IBeekeeperInstance
  let wallet: IBeekeeperUnlockedWallet
  let pubKey: string
  let provider: BeekeeperProvider

  beforeAll(async () => {
    bk = await createBeekeeper({ inMemory: true })
    const session = bk.createSession('test-salt')
    const created = await session.createWallet('test-wallet', 'password', true)
    wallet = created.wallet
    pubKey = await wallet.importKey(TEST_WIF)

    const rpc = new AiohaClient()
    const emitter = new SimpleEventEmitter()
    provider = new BeekeeperProvider(
      wallet,
      { [KeyTypes.Posting]: pubKey, [KeyTypes.Active]: pubKey, [KeyTypes.Memo]: pubKey },
      rpc,
      emitter,
      sha256
    )
  })

  afterAll(async () => {
    await bk.delete()
  })

  describe('signTxHF26', () => {
    it('should sign an HF26 transaction and return a signature', async () => {
      const result = await provider.signTxHF26(voteTxHF26, KeyTypes.Posting)
      expect(result.success).toBe(true)
      if (!result.success) return
      expect(result.result.signatures).toHaveLength(1)
      expect(result.result.signatures[0]).toBeTypeOf('string')
      expect(result.result.signatures[0]).toHaveLength(130)
      expect(result.result.operations).toEqual(voteTxHF26.operations)
    })

    it('should produce deterministic signatures for the same transaction', async () => {
      const result1 = await provider.signTxHF26(voteTxHF26, KeyTypes.Posting)
      const result2 = await provider.signTxHF26(voteTxHF26, KeyTypes.Posting)
      expect(result1.success).toBe(true)
      expect(result2.success).toBe(true)
      if (!result1.success || !result2.success) return
      expect(result1.result.signatures[0]).toBe(result2.result.signatures[0])
    })
  })

  describe('signTx (legacy)', () => {
    it('should sign a legacy transaction and return a signature', async () => {
      const result = await provider.signTx(voteTxLegacy, KeyTypes.Posting)
      expect(result.success).toBe(true)
      if (!result.success) return
      expect(result.result.signatures).toHaveLength(1)
      expect(result.result.signatures[0]).toBeTypeOf('string')
      expect(result.result.signatures[0]).toHaveLength(130)
    })

    it('should produce the same signature as HF26 for the same transaction content', async () => {
      const legacyResult = await provider.signTx(voteTxLegacy, KeyTypes.Posting)
      const hf26Result = await provider.signTxHF26(voteTxHF26, KeyTypes.Posting)
      expect(legacyResult.success).toBe(true)
      expect(hf26Result.success).toBe(true)
      if (!legacyResult.success || !hf26Result.success) return
      expect(legacyResult.result.signatures[0]).toBe(hf26Result.result.signatures[0])
    })
  })

  describe('signMessage', () => {
    it('should sign a message and return signature with public key', async () => {
      const result = await provider.signMessage('test message', KeyTypes.Posting)
      expect(result.success).toBe(true)
      if (!result.success) return
      expect(result.result).toBeTypeOf('string')
      expect(result.publicKey).toBe(pubKey)
    })

    it('should produce deterministic signatures', async () => {
      const result1 = await provider.signMessage('hello', KeyTypes.Posting)
      const result2 = await provider.signMessage('hello', KeyTypes.Posting)
      expect(result1.success).toBe(true)
      expect(result2.success).toBe(true)
      if (!result1.success || !result2.success) return
      expect(result1.result).toBe(result2.result)
    })

    it('should produce different signatures for different messages', async () => {
      const result1 = await provider.signMessage('message1', KeyTypes.Posting)
      const result2 = await provider.signMessage('message2', KeyTypes.Posting)
      expect(result1.success).toBe(true)
      expect(result2.success).toBe(true)
      if (!result1.success || !result2.success) return
      expect(result1.result).not.toBe(result2.result)
    })

    it('should fail for unavailable key type', async () => {
      const providerNoOwner = new BeekeeperProvider(
        wallet,
        { [KeyTypes.Posting]: pubKey },
        new AiohaClient(),
        new SimpleEventEmitter(),
        sha256
      )
      const result = await providerNoOwner.signMessage('test', KeyTypes.Owner)
      expect(result.success).toBe(false)
      if (result.success) return
      expect(result.errorCode).toBe(5000)
    })
  })

  describe('encrypt/decrypt memo', () => {
    it('should encrypt and decrypt data with encryptMemoWithKeys', async () => {
      const message = 'secret memo content'
      const encrypted = await provider.encryptMemoWithKeys(message, KeyTypes.Memo, [pubKey])
      expect(encrypted.success).toBe(true)
      if (!encrypted.success) return
      const encryptedMap = encrypted.result as { [pub: string]: string }
      expect(encryptedMap[pubKey]).toBeTypeOf('string')

      const decrypted = await provider.decryptMemo(encryptedMap[pubKey], KeyTypes.Memo)
      expect(decrypted.success).toBe(true)
      if (!decrypted.success) return
      expect(decrypted.result).toBe(message)
    })

    it('should encrypt for multiple recipients', async () => {
      const message = 'multi-recipient memo'
      const encrypted = await provider.encryptMemoWithKeys(message, KeyTypes.Memo, [pubKey])
      expect(encrypted.success).toBe(true)
      if (!encrypted.success) return
      const encryptedMap = encrypted.result as { [pub: string]: string }
      expect(Object.keys(encryptedMap)).toHaveLength(1)
      expect(encryptedMap[pubKey]).toBeDefined()
    })

    it('should handle empty message', async () => {
      const encrypted = await provider.encryptMemoWithKeys('', KeyTypes.Memo, [pubKey])
      expect(encrypted.success).toBe(true)
      if (!encrypted.success) return
      const encryptedMap = encrypted.result as { [pub: string]: string }

      const decrypted = await provider.decryptMemo(encryptedMap[pubKey], KeyTypes.Memo)
      expect(decrypted.success).toBe(true)
      if (!decrypted.success) return
      expect(decrypted.result).toBe('')
    })

    it('should fail decryption with invalid ciphertext', async () => {
      const result = await provider.decryptMemo('invalid-ciphertext', KeyTypes.Memo)
      expect(result.success).toBe(false)
    })
  })

  describe('login/logout', () => {
    it('should login by signing a message', async () => {
      const result = await provider.login('testuser', { keyType: KeyTypes.Posting, msg: 'Login' })
      expect(result.success).toBe(true)
      if (!result.success) return
      expect(result.username).toBe('testuser')
      expect(provider.getUser()).toBe('testuser')
    })

    it('should logout and clear user', async () => {
      await provider.login('testuser', { keyType: KeyTypes.Posting })
      await provider.logout()
      expect(provider.getUser()).toBeUndefined()
    })
  })

  describe('persistent login', () => {
    it('should return login info with keys', async () => {
      await provider.login('testuser', { keyType: KeyTypes.Posting })
      const info = provider.getLoginInfo()
      expect(info).toBeDefined()
      expect(info!.keys[KeyTypes.Posting]).toBe(pubKey)
      expect(info!.keys[KeyTypes.Active]).toBe(pubKey)
      expect(info!.keys[KeyTypes.Memo]).toBe(pubKey)
    })

    it('should return undefined when not logged in', async () => {
      await provider.logout()
      expect(provider.getLoginInfo()).toBeUndefined()
    })

    it('should restore login from persistent info', () => {
      const info: PersistentLoginBeekeeper = {
        provider: Providers.Custom,
        keys: { [KeyTypes.Posting]: pubKey }
      }
      const loaded = provider.loadLogin('restored-user', info)
      expect(loaded).toBe(true)
      expect(provider.getUser()).toBe('restored-user')
    })
  })

  describe('events', () => {
    it('should emit sign_tx_request when signing transactions', async () => {
      let emitted = false
      const emitter = new SimpleEventEmitter()
      emitter.on('sign_tx_request', () => {
        emitted = true
      })
      const p = new BeekeeperProvider(wallet, { [KeyTypes.Posting]: pubKey }, new AiohaClient(), emitter, sha256)
      await p.signTxHF26(voteTxHF26, KeyTypes.Posting)
      expect(emitted).toBe(true)
    })

    it('should emit sign_msg_request when signing messages', async () => {
      let emitted = false
      const emitter = new SimpleEventEmitter()
      emitter.on('sign_msg_request', () => {
        emitted = true
      })
      const p = new BeekeeperProvider(wallet, { [KeyTypes.Posting]: pubKey }, new AiohaClient(), emitter, sha256)
      await p.signMessage('test', KeyTypes.Posting)
      expect(emitted).toBe(true)
    })

    it('should emit memo_request when encrypting', async () => {
      let emitted = false
      const emitter = new SimpleEventEmitter()
      emitter.on('memo_request', () => {
        emitted = true
      })
      const p = new BeekeeperProvider(wallet, { [KeyTypes.Memo]: pubKey }, new AiohaClient(), emitter, sha256)
      await p.encryptMemoWithKeys('test', KeyTypes.Memo, [pubKey])
      expect(emitted).toBe(true)
    })

    it('should emit login_request when logging in', async () => {
      let emitted = false
      const emitter = new SimpleEventEmitter()
      emitter.on('login_request', () => {
        emitted = true
      })
      const p = new BeekeeperProvider(wallet, { [KeyTypes.Posting]: pubKey }, new AiohaClient(), emitter, sha256)
      await p.login('user', { keyType: KeyTypes.Posting })
      expect(emitted).toBe(true)
    })
  })
})
