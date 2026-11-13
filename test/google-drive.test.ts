import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import createBeekeeper from '@hiveio/beekeeper'
import { PrivateKey, PublicKey, Signature, Memo } from '@hiveio/dhive'
import { sha256 } from '@noble/hashes/sha2.js'
import { transactionDigest } from '@aioha/tx-digest'
import { Aioha } from '../src/index.js'
import { AiohaClient } from '../src/rpc.js'
import { SimpleEventEmitter } from '../src/lib/event-emitter.js'
import { KeyTypes, Providers } from '../src/types.js'
import {
  GoogleDriveProvider,
  createGoogleDriveTokenProvider,
  type GoogleDriveProviderOptions
} from '../src/providers/google-drive.js'
import {
  GoogleDriveBridgeAuthError,
  createGoogleDriveBridgeTokenProvider
} from '../src/lib/external-storage/hive-bridge.js'
import {
  deriveWalletEncryptionKey,
  decryptWalletData,
  decryptMemo,
  encryptMemo,
  encryptWalletData,
  getPublicKeyFromWif,
  messageDigest,
  signDigest
} from '../src/lib/crypto.js'
import { GoogleDriveStorage, GoogleDriveError } from '../src/lib/external-storage/google-drive-storage.js'
import { BeekeeperProvider } from '../src/providers/custom/beekeeper.js'
import { PlaintextKeyProvider } from '../src/providers/custom/plaintext.js'
import { createEmptyWallet, migrateWalletData } from '../src/lib/external-storage/wallet-data.js'
import { StorageFileNotFoundError, type WalletStorage } from '../src/lib/external-storage/storage.js'
import type { HF26Transaction } from '@aioha/types/dist/hive/hf26.js'
import type { LegacyTransaction } from '@aioha/types/dist/hive/legacy.js'

const PASSWORD = 'test-password'
const ALICE_WIF = PrivateKey.fromLogin('alice', 'posting-password', 'posting').toString()
const BOB_WIF = PrivateKey.fromLogin('bob', 'posting-password', 'posting').toString()
const RECIPIENT_WIF = PrivateKey.fromLogin('recipient', 'posting-password', 'posting').toString()
const BRIDGE_URL = 'https://bridge.example.com'

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

class MemoryStorage implements WalletStorage {
  readonly files = new Map<string, string>()

  async get(name: string): Promise<string> {
    const content = this.files.get(name)
    if (typeof content === 'undefined') throw new StorageFileNotFoundError(`file '${name}' not found`)
    return content
  }

  async save(name: string, data: string): Promise<void> {
    this.files.set(name, data)
  }

  async delete(name: string): Promise<void> {
    if (!this.files.delete(name)) throw new StorageFileNotFoundError(`file '${name}' not found`)
  }

  async exists(name: string): Promise<boolean> {
    return this.files.has(name)
  }
}

interface MockFile {
  id: string
  name: string
  content: string
}

const createMockDrive = () => {
  const files = new Map<string, MockFile>()
  let nextId = 0
  const tokenProvider = vi.fn(() => 'test-token')
  const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    const method = (init?.method ?? 'GET').toUpperCase()
    const headers = new Headers(init?.headers)
    if (headers.get('Authorization') !== 'Bearer test-token') return new Response('Unauthorized', { status: 401 })

    if (url.startsWith('https://www.googleapis.com/drive/v3/files?')) {
      const query = decodeURIComponent(url.match(/q=([^&]+)/)![1])
      const name = query.match(/name='([^']+)'/)![1]
      const file = [...files.values()].find((f) => f.name === name)
      return Response.json({ files: file ? [{ id: file.id, name: file.name }] : [] })
    }
    const media = url.match(/\/drive\/v3\/files\/([^/?]+)\?alt=media/)
    if (media) {
      const file = files.get(media[1])
      if (!file) return new Response('Not Found', { status: 404 })
      return new Response(file.content, { status: 200, headers: { 'Content-Type': 'text/plain' } })
    }
    const upload = url.match(/\/upload\/drive\/v3\/files\/([^/?]+)\?uploadType=media/)
    if (upload && method === 'PATCH') {
      const file = files.get(upload[1])
      if (!file) return new Response('Not Found', { status: 404 })
      file.content = String(init?.body)
      return new Response('', { status: 200 })
    }
    if (url.includes('/upload/drive/v3/files?uploadType=multipart') && method === 'POST') {
      const body = String(init?.body)
      const boundary = (headers.get('Content-Type') ?? '').match(/boundary=(.+)$/)![1]
      const parts = body.split(`--${boundary}`)
      const metadata = JSON.parse(parts[1].split('\r\n\r\n')[1].trim()) as { name: string }
      const content = parts[2]
        .split('\r\n\r\n')
        .slice(1)
        .join('\r\n\r\n')
        .replace(/\r\n$/, '')
      const id = String(++nextId)
      files.set(id, { id, name: metadata.name, content })
      return Response.json({ id, name: metadata.name })
    }
    const remove = url.match(/\/drive\/v3\/files\/([^/?]+)$/)
    if (remove && method === 'DELETE') {
      if (!files.delete(remove[1])) return new Response('Not Found', { status: 404 })
      return new Response('', { status: 200 })
    }
    return new Response('Not Found', { status: 404 })
  })
  return { files, fetchMock, tokenProvider }
}

const createProvider = (
  storage: WalletStorage,
  passwordProvider: GoogleDriveProviderOptions['passwordProvider'] = async () => ({ password: PASSWORD }),
  signer: GoogleDriveProviderOptions['signer'] = new PlaintextKeyProvider()
) => {
  const provider = new GoogleDriveProvider(
    { storage, passwordProvider, signer },
    new AiohaClient('https://api.test'),
    new SimpleEventEmitter()
  )
  return provider
}

describe('Google Drive crypto helpers', () => {
  it('derives keys in the same way as wax and dhive', () => {
    expect(deriveWalletEncryptionKey(PASSWORD)).toBe(PrivateKey.fromLogin('dummyaccount', PASSWORD, 'posting').toString())
    expect(getPublicKeyFromWif(ALICE_WIF)).toBe(PrivateKey.from(ALICE_WIF).createPublic().toString())
  })

  it('round-trips wallet data', async () => {
    const encryptionKey = deriveWalletEncryptionKey(PASSWORD)
    const content = JSON.stringify({ version: '3.0.0', hive: { accounts: {} } })
    const encrypted = await encryptWalletData(content, encryptionKey, BigInt(1234567890123456))
    expect(await decryptWalletData(encrypted, encryptionKey)).toBe(content)
    await expect(decryptWalletData(encrypted, deriveWalletEncryptionKey('wrong'))).rejects.toThrow(/invalid password/)
  })

  it('produces wallet files that beekeeper can decrypt and reads beekeeper wallet files', async () => {
    const encryptionKey = deriveWalletEncryptionKey(PASSWORD)
    const content = JSON.stringify({ version: '3.0.0', hive: { accounts: { alice: {} } } })
    const bk = await createBeekeeper({ inMemory: true })
    try {
      const session = bk.createSession('test-salt')
      const { wallet } = await session.createWallet('test-wallet', 'password', true)
      const publicKey = await wallet.importKey(encryptionKey)

      const ours = await encryptWalletData(content, encryptionKey, BigInt(1234567890123456))
      expect(wallet.decryptData(ours, publicKey)).toBe(content)

      const theirs = wallet.encryptData(content, publicKey, undefined, 1234567890123456)
      expect(await decryptWalletData(theirs, encryptionKey)).toBe(content)
    } finally {
      await bk.delete()
    }
  })

  it('produces standard Hive memos compatible with dhive', async () => {
    const recipientPublicKey = PrivateKey.from(RECIPIENT_WIF).createPublic().toString()
    const encrypted = await encryptMemo('hello', ALICE_WIF, recipientPublicKey)
    expect(Memo.decode(RECIPIENT_WIF, encrypted)).toBe('#hello')
    expect(await decryptMemo(encrypted, RECIPIENT_WIF)).toBe('#hello')
    expect(await decryptMemo(Memo.encode(ALICE_WIF, recipientPublicKey, '#world'), RECIPIENT_WIF)).toBe('#world')
  })

  it('handles wallet payloads and memos larger than a single varint byte', async () => {
    const encryptionKey = deriveWalletEncryptionKey(PASSWORD)
    const content = JSON.stringify({ version: '3.0.0', data: 'x'.repeat(5000) })
    const encrypted = await encryptWalletData(content, encryptionKey)
    expect(await decryptWalletData(encrypted, encryptionKey)).toBe(content)

    const recipientPublicKey = PrivateKey.from(RECIPIENT_WIF).createPublic().toString()
    const memo = 'm'.repeat(1000)
    const encryptedMemo = await encryptMemo(memo, ALICE_WIF, recipientPublicKey)
    expect(Memo.decode(RECIPIENT_WIF, encryptedMemo)).toBe('#' + memo)
    expect(await decryptMemo(encryptedMemo, RECIPIENT_WIF)).toBe('#' + memo)
  })

  it('produces canonical signatures that dhive can verify', () => {
    const digest = messageDigest('hello')
    const signature = signDigest(digest, ALICE_WIF)
    const publicKey = PrivateKey.from(ALICE_WIF).createPublic()
    expect(publicKey.verify(Buffer.from(digest), Signature.fromString(signature))).toBe(true)
    expect(parseInt(signature.slice(0, 2), 16)).toBeGreaterThanOrEqual(31)
  })
})

describe('wallet data format', () => {
  it('creates empty wallets and migrates older versions to V3', () => {
    expect(createEmptyWallet()).toEqual({ version: '3.0.0', hive: { accounts: {} } })

    const v2 = migrateWalletData({
      version: '2.0.0',
      hive: { account: 'alice', roleDefinitions: { posting: { privateKey: ALICE_WIF } } },
      generalPurposeKeys: { custom: { privateKey: ALICE_WIF } }
    })
    expect(v2.hive.accounts.alice.roleDefinitions.posting!.privateKey).toBe(ALICE_WIF)
    expect(v2.generalPurposeKeys!.custom.privateKey).toBe(ALICE_WIF)

    const v1 = migrateWalletData({
      version: '1.0.0',
      hive: { account: 'alice', roleDefinitions: { active: { privateKey: BOB_WIF } } }
    })
    expect(v1.hive.accounts.alice.roleDefinitions.active!.privateKey).toBe(BOB_WIF)
  })

  it('ignores unknown roles and rejects unknown versions', () => {
    const wallet = migrateWalletData({
      version: '3.0.0',
      hive: {
        accounts: {
          alice: { roleDefinitions: { posting: { privateKey: ALICE_WIF }, unknown: { privateKey: BOB_WIF } } }
        }
      }
    })
    expect(Object.keys(wallet.hive.accounts.alice.roleDefinitions)).toEqual(['posting'])
    expect(() => migrateWalletData({ version: '9.9.9' })).toThrow(/unknown wallet data version/)
    expect(() => migrateWalletData('not-a-wallet')).toThrow(/invalid wallet data/)
  })
})

describe('GoogleDriveStorage', () => {
  let drive: ReturnType<typeof createMockDrive>

  beforeEach(() => {
    drive = createMockDrive()
    vi.stubGlobal('fetch', drive.fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('creates, reads, updates and deletes files', async () => {
    const storage = new GoogleDriveStorage(drive.tokenProvider)
    expect(await storage.exists('wallet.json')).toBe(false)
    await expect(storage.get('wallet.json')).rejects.toBeInstanceOf(StorageFileNotFoundError)

    await storage.save('wallet.json', 'first')
    expect(await storage.exists('wallet.json')).toBe(true)
    expect(await storage.get('wallet.json')).toBe('first')

    await storage.save('wallet.json', 'second')
    expect(await storage.get('wallet.json')).toBe('second')

    await storage.delete('wallet.json')
    expect(await storage.exists('wallet.json')).toBe(false)
    await expect(storage.delete('wallet.json')).rejects.toBeInstanceOf(StorageFileNotFoundError)
  })

  it('requests a fresh token for every API call', async () => {
    const storage = new GoogleDriveStorage(drive.tokenProvider)
    await storage.save('wallet.json', 'x')
    await storage.get('wallet.json')
    await storage.exists('wallet.json')
    expect(drive.tokenProvider).toHaveBeenCalledTimes(5)
  })

  it('throws GoogleDriveError for authentication failures', async () => {
    const storage = new GoogleDriveStorage(() => 'bad-token')
    await expect(storage.exists('wallet.json')).rejects.toBeInstanceOf(GoogleDriveError)
    await expect(storage.get('wallet.json')).rejects.toBeInstanceOf(GoogleDriveError)
  })
})

describe('GoogleDriveProvider', () => {
  let storage: MemoryStorage

  beforeEach(() => {
    storage = new MemoryStorage()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('requires a signer', () => {
    expect(
      () =>
        new GoogleDriveProvider(
          {
            storage,
            passwordProvider: async () => ({ password: PASSWORD })
          } as any,
          new AiohaClient('https://api.test'),
          new SimpleEventEmitter()
        )
    ).toThrow(/signer is required/)
  })

  it('stores keys encrypted in the wallet file and creates it on first use', async () => {
    const passwordProvider = vi.fn(async () => ({ password: PASSWORD }))
    const provider = createProvider(storage, passwordProvider)
    const result = await provider.storeKey(KeyTypes.Posting, 'alice', ALICE_WIF)

    expect(result.success).toBe(true)
    if (result.success) expect(result.result).toBe(getPublicKeyFromWif(ALICE_WIF))
    expect(passwordProvider).toHaveBeenCalledWith(true)
    const raw = storage.files.get('wallet.json')!
    expect(raw).not.toContain(ALICE_WIF)
    expect(raw).not.toContain('"version"')
    expect(await decryptWalletData(raw, provider.getEncryptionKeyWif()!)).toContain('"alice"')
    expect(await provider.getStoredAccounts()).toEqual(['alice'])
    expect(await provider.getStoredRoles('alice')).toEqual([KeyTypes.Posting])
  })

  it('logs in by loading and signing with the stored key', async () => {
    const storeProvider = createProvider(storage)
    await storeProvider.storeKey(KeyTypes.Posting, 'alice', ALICE_WIF)

    const passwordProvider = vi.fn(async () => ({ password: PASSWORD }))
    const provider = createProvider(storage, passwordProvider)
    const login = await provider.login('alice', { msg: 'Login' })

    expect(login.success).toBe(true)
    if (!login.success) return
    expect(login.username).toBe('alice')
    expect(login.provider).toBe(Providers.GoogleDrive)
    expect(login.publicKey).toBe(getPublicKeyFromWif(ALICE_WIF))
    expect(provider.getUser()).toBe('alice')
    expect(passwordProvider).toHaveBeenCalledWith(false)
    expect(provider.isUnlocked()).toBe(true)

    const signed = await provider.signMessage('test message', KeyTypes.Posting)
    expect(signed.success).toBe(true)
    if (!signed.success) return
    const digest = messageDigest('test message')
    expect(
      PublicKey.fromString(signed.publicKey!).verify(Buffer.from(digest), Signature.fromString(signed.result))
    ).toBe(true)
  })

  it('logs in by decrypting a memo with the stored key', async () => {
    const provider = createProvider(storage)
    await provider.storeKey(KeyTypes.Posting, 'alice', ALICE_WIF)
    const memo = await encryptMemo('hello', ALICE_WIF, getPublicKeyFromWif(ALICE_WIF))

    const login = await provider.loginAndDecryptMemo('alice', { msg: memo })
    expect(login.success).toBe(true)
    if (login.success) {
      expect(login.username).toBe('alice')
      expect(login.result).toBe('#hello')
      expect(provider.getLoginInfo()!.pubKey).toBe(getPublicKeyFromWif(ALICE_WIF))
    }
  })

  it('fails login when the account or key type is not stored', async () => {
    const provider = createProvider(storage)
    await provider.storeKey(KeyTypes.Posting, 'alice', ALICE_WIF)

    const missingAccount = await provider.login('bob', {})
    expect(missingAccount.success).toBe(false)
    if (!missingAccount.success) {
      expect(missingAccount.errorCode).toBe(5000)
      expect(missingAccount.error).toMatch(/no posting key found for account bob/)
    }

    const missingRole = await provider.login('alice', { keyType: KeyTypes.Active })
    expect(missingRole.success).toBe(false)
    if (!missingRole.success) expect(missingRole.error).toMatch(/no active key found for account alice/)
  })

  it('unlocks with a cached encryption key instead of the password', async () => {
    const storeProvider = createProvider(storage)
    await storeProvider.storeKey(KeyTypes.Posting, 'alice', ALICE_WIF)
    const encryptionKey = storeProvider.getEncryptionKeyWif()!

    const passwordProvider = vi.fn(async () => ({ encryptionKey }))
    const provider = createProvider(storage, passwordProvider)
    const login = await provider.login('alice', {})
    expect(login.success).toBe(true)
    expect(passwordProvider).toHaveBeenCalledWith(false)
  })

  it('rejects an incorrect password without overwriting the wallet', async () => {
    const storeProvider = createProvider(storage)
    await storeProvider.storeKey(KeyTypes.Posting, 'alice', ALICE_WIF)
    const original = storage.files.get('wallet.json')!

    const provider = createProvider(storage, async () => ({ password: 'wrong-password' }))
    const login = await provider.login('alice', {})
    expect(login.success).toBe(false)
    if (!login.success) expect(login.error).toMatch(/failed to decrypt wallet data/)
    expect(storage.files.get('wallet.json')).toBe(original)
  })

  it('reads wallet files written by @hiveio/wax-signers-external', async () => {
    const encryptionKey = deriveWalletEncryptionKey(PASSWORD)
    const bk = await createBeekeeper({ inMemory: true })
    try {
      const session = bk.createSession('test-salt')
      const { wallet } = await session.createWallet('test-wallet', 'password', true)
      const publicKey = await wallet.importKey(encryptionKey)
      storage.files.set(
        'wallet.json',
        wallet.encryptData(
          JSON.stringify({
            version: '3.0.0',
            hive: { accounts: { alice: { roleDefinitions: { posting: { privateKey: ALICE_WIF } } } } }
          }),
          publicKey
        )
      )
    } finally {
      await bk.delete()
    }

    const provider = createProvider(storage)
    const login = await provider.login('alice', {})
    expect(login.success).toBe(true)
    expect(provider.getUser()).toBe('alice')
  })

  it('removes keys and deletes accounts that have no keys left', async () => {
    const provider = createProvider(storage)
    await provider.storeKey(KeyTypes.Posting, 'alice', ALICE_WIF)
    await provider.storeKey(KeyTypes.Active, 'alice', ALICE_WIF)

    expect(await provider.getStoredRoles('alice')).toEqual([KeyTypes.Posting, KeyTypes.Active])
    const removedPosting = await provider.removeKey(KeyTypes.Posting, 'alice')
    expect(removedPosting.success).toBe(true)
    expect(await provider.getStoredRoles('alice')).toEqual([KeyTypes.Active])
    const removedActive = await provider.removeKey(KeyTypes.Active, 'alice')
    expect(removedActive.success).toBe(true)
    expect(await provider.getStoredAccounts()).toEqual([])
    expect((await provider.removeKey(KeyTypes.Active, 'alice')).success).toBe(false)
  })

  it('encrypts and decrypts memos', async () => {
    const provider = createProvider(storage)
    await provider.storeKey(KeyTypes.Posting, 'alice', ALICE_WIF)
    await provider.login('alice', {})

    const recipientPublicKey = PrivateKey.from(RECIPIENT_WIF).createPublic().toString()
    const encrypted = await provider.encryptMemoWithKeys('secret memo', KeyTypes.Posting, [recipientPublicKey])
    expect(encrypted.success).toBe(true)
    if (!encrypted.success) return
    const encryptedMemo = (encrypted.result as Record<string, string>)[recipientPublicKey]
    expect(encryptedMemo).toMatch(/^#/)

    const decrypted = await provider.decryptMemo(encryptedMemo, KeyTypes.Posting)
    expect(decrypted.success).toBe(true)
    if (decrypted.success) expect(decrypted.result).toBe('#secret memo')
  })

  it('encrypts memos for a recipient account', async () => {
    const provider = createProvider(storage)
    await provider.storeKey(KeyTypes.Posting, 'alice', ALICE_WIF)
    await provider.login('alice', {})
    const recipientPublicKey = PrivateKey.from(RECIPIENT_WIF).createPublic().toString()
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        Response.json({
          memo: recipientPublicKey,
          posting: { key_auths: [[recipientPublicKey, 1]], account_auths: [], weight_threshold: 1 },
          active: { key_auths: [[recipientPublicKey, 1]], account_auths: [], weight_threshold: 1 },
          owner: { key_auths: [[recipientPublicKey, 1]], account_auths: [], weight_threshold: 1 }
        })
      )
    )

    const encrypted = await provider.encryptMemo('#secret memo', KeyTypes.Posting, 'recipient')
    expect(encrypted.success).toBe(true)
    if (encrypted.success) expect(encrypted.result).toMatch(/^#/)
  })

  it('discovers stored accounts and roles', async () => {
    const provider = createProvider(storage)
    await provider.storeKey(KeyTypes.Posting, 'alice', ALICE_WIF)
    await provider.storeKey(KeyTypes.Active, 'alice', ALICE_WIF)
    await provider.storeKey(KeyTypes.Memo, 'bob', BOB_WIF)

    const discovered = await provider.discoverAccounts(undefined, { roles: [KeyTypes.Posting, KeyTypes.Memo] })
    expect(discovered.success).toBe(true)
    if (!discovered.success) return
    expect(Object.keys(discovered.result)).toEqual(['alice', 'bob'])
    expect((discovered.result as any).alice).toHaveLength(1)
    expect((discovered.result as any).bob[0].role).toBe('memo')

    const streamed: string[] = []
    await provider.discoverAccounts((account) => streamed.push(account.username))
    expect(streamed).toEqual(expect.arrayContaining(['alice', 'alice', 'bob']))
  })

  it('signs HF26 and legacy transactions', async () => {
    const provider = createProvider(storage)
    await provider.storeKey(KeyTypes.Posting, 'alice', ALICE_WIF)
    await provider.login('alice', {})
    const publicKey = PrivateKey.from(ALICE_WIF).createPublic()

    const hf26 = await provider.signTxHF26(voteTxHF26, KeyTypes.Posting)
    expect(hf26.success).toBe(true)
    if (hf26.success) {
      const { digest } = await transactionDigest(voteTxHF26, undefined, sha256)
      expect(publicKey.verify(Buffer.from(digest), Signature.fromString(hf26.result.signatures[0]))).toBe(true)
    }

    const legacy = await provider.signTx(voteTxLegacy, KeyTypes.Posting)
    expect(legacy.success).toBe(true)
    if (legacy.success) expect(legacy.result.signatures[0]).toBeTypeOf('string')
  })

  it('locks the wallet and unlocks it again on the next operation', async () => {
    const provider = createProvider(storage)
    await provider.storeKey(KeyTypes.Posting, 'alice', ALICE_WIF)
    expect(provider.isUnlocked()).toBe(true)
    expect(provider.getEncryptionKeyWif()).toBeTypeOf('string')

    provider.lock()
    expect(provider.isUnlocked()).toBe(false)
    expect(provider.getEncryptionKeyWif()).toBeUndefined()

    const login = await provider.login('alice', {})
    expect(login.success).toBe(true)
    expect(provider.isUnlocked()).toBe(true)
  })

  it('returns persistent login info that can be restored', async () => {
    const provider = createProvider(storage)
    await provider.storeKey(KeyTypes.Posting, 'alice', ALICE_WIF)
    await provider.login('alice', {})
    const info = provider.getLoginInfo()
    expect(info).toEqual({ provider: Providers.GoogleDrive, pubKey: getPublicKeyFromWif(ALICE_WIF) })

    const restored = createProvider(storage)
    expect(restored.loadLogin('alice', info!)).toBe(true)
    expect(restored.getUser()).toBe('alice')
    expect(restored.getLoginInfo()).toEqual(info)
  })
})

describe('GoogleDriveProvider with an explicit signer', () => {
  it('injects drive keys into an explicit plaintext signer', async () => {
    const storage = new MemoryStorage()
    const signer = new PlaintextKeyProvider()
    const provider = new GoogleDriveProvider(
      {
        storage,
        passwordProvider: async () => ({ password: PASSWORD }),
        signer
      },
      new AiohaClient('https://api.test'),
      new SimpleEventEmitter()
    )

    await provider.storeKey(KeyTypes.Posting, 'alice', ALICE_WIF)
    const login = await provider.login('alice', {})
    expect(login.success).toBe(true)
    expect(signer.getUser()).toBe('alice')
    expect((await provider.signMessage('signed through signer', KeyTypes.Posting)).success).toBe(true)

    await provider.logout()
    expect(signer.getUser()).toBeUndefined()
    expect((await signer.signMessage('after logout', KeyTypes.Posting)).success).toBe(false)
  })
})

describe('GoogleDriveProvider with a beekeeper signer', () => {
  it('injects drive keys into beekeeper and signs through it', async () => {
    const storage = new MemoryStorage()
    const bk = await createBeekeeper({ inMemory: true })
    try {
      const session = bk.createSession('test-salt')
      const { wallet } = await session.createWallet('test-wallet', 'password', true)
      const signer = new BeekeeperProvider(
        wallet,
        {},
        new AiohaClient('https://api.test'),
        new SimpleEventEmitter(),
        sha256
      )
      const provider = new GoogleDriveProvider(
        {
          storage,
          passwordProvider: async () => ({ password: PASSWORD }),
          signer
        },
        new AiohaClient('https://api.test'),
        new SimpleEventEmitter()
      )

      const stored = await provider.storeKey(KeyTypes.Posting, 'alice', ALICE_WIF)
      expect(stored.success).toBe(true)
      const login = await provider.login('alice', {})
      expect(login.success).toBe(true)
      if (login.success) expect(login.publicKey).toBe(getPublicKeyFromWif(ALICE_WIF))

      expect(signer.getLoginInfo()!.keys[KeyTypes.Posting]).toBe(getPublicKeyFromWif(ALICE_WIF))
      const signed = await provider.signMessage('signed by beekeeper', KeyTypes.Posting)
      expect(signed.success).toBe(true)
      if (!signed.success) return
      const digest = messageDigest('signed by beekeeper')
      expect(
        PublicKey.fromString(signed.publicKey!).verify(Buffer.from(digest), Signature.fromString(signed.result))
      ).toBe(true)

      const signedTx = await provider.signTxHF26(voteTxHF26, KeyTypes.Posting)
      expect(signedTx.success).toBe(true)
      if (signedTx.success) {
        const { digest } = await transactionDigest(voteTxHF26, undefined, sha256)
        expect(
          PublicKey.fromString(signed.publicKey!).verify(
            Buffer.from(digest),
            Signature.fromString(signedTx.result.signatures[0])
          )
        ).toBe(true)
      }
    } finally {
      await bk.delete()
    }
  })
})

describe('GoogleDriveProvider with Google Drive storage', () => {
  it('stores and restores a wallet through the Drive API', async () => {
    const drive = createMockDrive()
    vi.stubGlobal('fetch', drive.fetchMock)
    try {
      const storeProvider = new GoogleDriveProvider({
        tokenProvider: drive.tokenProvider,
        passwordProvider: async () => ({ password: PASSWORD }),
        signer: new PlaintextKeyProvider()
      })
      const stored = await storeProvider.storeKey(KeyTypes.Posting, 'alice', ALICE_WIF)
      expect(stored.success).toBe(true)
      expect(drive.files.size).toBe(1)

      const provider = new GoogleDriveProvider({
        tokenProvider: drive.tokenProvider,
        passwordProvider: async () => ({ password: PASSWORD }),
        signer: new PlaintextKeyProvider()
      })
      const login = await provider.login('alice', {})
      expect(login.success).toBe(true)
      expect(provider.getUser()).toBe('alice')
    } finally {
      vi.unstubAllGlobals()
    }
  })
})

describe('Aioha integration', () => {
  it('registers as a built-in provider, logs in, switches accounts and reports the built-in name', async () => {
    const storage = new MemoryStorage()
    const passwordProvider = async () => ({ password: PASSWORD })
    const provider = createProvider(storage, passwordProvider)
    await provider.storeKey(KeyTypes.Posting, 'alice', ALICE_WIF)
    await provider.storeKey(KeyTypes.Posting, 'bob', BOB_WIF)

    const aioha = new Aioha()
    await aioha.registerGoogleDrive({ storage, passwordProvider, signer: new PlaintextKeyProvider() })
    expect(aioha.isProviderRegistered(Providers.GoogleDrive)).toBe(true)
    expect(aioha.getProviders()).toContain(Providers.GoogleDrive)
    expect(() => aioha.registerCustomProvider(Providers.GoogleDrive, provider)).toThrow(
      /reserved for a built-in provider/
    )

    // Built-in providers require an explicit key type
    const missingKeyType = await aioha.login(Providers.GoogleDrive, 'alice', { msg: 'Login' })
    expect(missingKeyType.success).toBe(false)
    if (!missingKeyType.success) expect(missingKeyType.errorCode).toBe(5003)

    const alice = await aioha.login(Providers.GoogleDrive, 'alice', { msg: 'Login', keyType: KeyTypes.Posting })
    expect(alice.success).toBe(true)
    expect(aioha.getCurrentProvider()).toBe(Providers.GoogleDrive)
    expect(aioha.getCurrentUser()).toBe('alice')
    expect(aioha.getPublicKey()).toBe(getPublicKeyFromWif(ALICE_WIF))
    expect(aioha.getPI().getLoginInfo()!.provider).toBe(Providers.GoogleDrive)

    const bob = await aioha.login(Providers.GoogleDrive, 'bob', { keyType: KeyTypes.Posting })
    expect(bob.success).toBe(true)
    expect(aioha.getOtherLogins()).toEqual({ alice: Providers.GoogleDrive })
    expect(aioha.switchUser('alice')).toBe(true)
    expect(aioha.getCurrentUser()).toBe('alice')
    expect(aioha.getCurrentProvider()).toBe(Providers.GoogleDrive)
  })
})

describe('createGoogleDriveTokenProvider', () => {
  const createGoogle = (response: { access_token?: string; expires_in?: number; error?: string; error_description?: string }) => {
    let callback: ((response: any) => void) | undefined
    const requestAccessToken = vi.fn()
    const initTokenClient = vi.fn((config: any) => {
      callback = config.callback
      return {
        requestAccessToken: () => {
          requestAccessToken()
          callback!(response)
        }
      }
    })
    return { google: { accounts: { oauth2: { initTokenClient } } }, requestAccessToken, initTokenClient }
  }

  it('caches tokens and refreshes them after clearToken', async () => {
    const { google, initTokenClient } = createGoogle({ access_token: 'token-1', expires_in: 3600 })
    const tokenProvider = createGoogleDriveTokenProvider({ clientId: 'client-id', google })
    expect(await tokenProvider()).toBe('token-1')
    expect(await tokenProvider()).toBe('token-1')
    expect(initTokenClient).toHaveBeenCalledTimes(1)

    tokenProvider.clearToken()
    expect(await tokenProvider()).toBe('token-1')
    expect(initTokenClient).toHaveBeenCalledTimes(2)
  })

  it('rejects when Google returns an error', async () => {
    const { google } = createGoogle({ error: 'access_denied', error_description: 'User denied access' })
    const tokenProvider = createGoogleDriveTokenProvider({ clientId: 'client-id', google })
    await expect(tokenProvider()).rejects.toThrow('User denied access')
  })

  it('throws a helpful error when Google Identity Services is not loaded', async () => {
    const tokenProvider = createGoogleDriveTokenProvider({ clientId: 'client-id', google: {} })
    await expect(tokenProvider()).rejects.toThrow(/Google Identity Services is not loaded/)
  })
})

describe('createGoogleDriveBridgeTokenProvider', () => {
  const createFetch = (status: number, body: unknown) =>
    vi.fn(
      async (_input: string | URL | Request, _init?: RequestInit) =>
        new Response(JSON.stringify(body), {
          status,
          headers: { 'Content-Type': 'application/json' }
        })
    )

  it('supports a custom bridge URL and credentials mode', async () => {
    const fetchMock = createFetch(200, { success: true, token: 'token-2' })
    const tokenProvider = createGoogleDriveBridgeTokenProvider({
      bridgeUrl: BRIDGE_URL,
      credentials: 'same-origin',
      fetch: fetchMock as unknown as typeof fetch
    })

    expect(tokenProvider.bridgeUrl).toBe(BRIDGE_URL)
    expect(await tokenProvider()).toBe('token-2')
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock).toHaveBeenCalledWith(
      `${BRIDGE_URL}/api/google-drive/token`,
      expect.objectContaining({ credentials: 'same-origin' })
    )
  })

  it('throws an auth error with the login URL when the bridge has no Google session', async () => {
    const fetchMock = createFetch(401, { message: 'Not authenticated with Google' })
    const tokenProvider = createGoogleDriveBridgeTokenProvider({ fetch: fetchMock as unknown as typeof fetch, bridgeUrl: BRIDGE_URL })
    const request = tokenProvider()

    await expect(request).rejects.toBeInstanceOf(GoogleDriveBridgeAuthError)
    await expect(request).rejects.toMatchObject({
      statusCode: 401,
      loginUrl: `${BRIDGE_URL}/api/auth/google/login`
    })
    await expect(request).rejects.toThrow(`Sign in at ${BRIDGE_URL}/api/auth/google/login`)
  })

  it('reports other bridge errors', async () => {
    const fetchMock = createFetch(500, { message: 'Failed to get access token' })
    const tokenProvider = createGoogleDriveBridgeTokenProvider({ fetch: fetchMock as unknown as typeof fetch, bridgeUrl: BRIDGE_URL })
    const request = tokenProvider()

    await expect(request).rejects.toBeInstanceOf(GoogleDriveError)
    await expect(request).rejects.toMatchObject({ statusCode: 500 })
    await expect(request).rejects.toThrow('Failed to get access token')
  })

  it('rejects an empty token', async () => {
    const fetchMock = createFetch(200, { success: true })
    const tokenProvider = createGoogleDriveBridgeTokenProvider({ fetch: fetchMock as unknown as typeof fetch, bridgeUrl: BRIDGE_URL })
    await expect(tokenProvider()).rejects.toThrow(/empty Google access token/)
  })
})
