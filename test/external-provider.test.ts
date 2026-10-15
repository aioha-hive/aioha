import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest'
import createBeekeeper, { type IBeekeeperInstance, type IBeekeeperUnlockedWallet } from '@hiveio/beekeeper'
import { sha256 } from '@noble/hashes/sha2.js'
import { PrivateKey, PublicKey, Signature } from '@hiveio/dhive'
import { transactionDigest } from '@aioha/tx-digest'
import { Aioha } from '../src/index.js'
import { AiohaClient } from '../src/rpc.js'
import { SimpleEventEmitter } from '../src/lib/event-emitter.js'
import { BeekeeperProvider } from '../src/providers/custom/beekeeper.js'
import {
  ExternalWalletProvider,
  deriveEncryptionKey,
  type ExternalWalletProviderOptions,
  type TStoragePasswordProvider
} from '../src/providers/custom/external.js'
import { createEmptyWalletData, migrateWalletData } from '../src/providers/custom/lib/wallet-data.js'
import { GoogleDriveError, GoogleStorageProvider } from '../src/providers/custom/lib/google-drive-storage.js'
import { AStorageProviderBase, StorageFileNotFoundError } from '../src/providers/custom/lib/storage-provider.js'
import { KeyTypes } from '../src/types.js'
import type { HF26Transaction } from '../src/lib/hf26-types.js'

const TEST_WIF = '5JkFnXrLM2ap9t3AmAxBJvQHF7xSKtnTrCTginQCkhzU5S7ecPT'
const PASSWORD = 'test-password'

interface MockFile {
  id: string
  name: string
  content: string
}

/** In-memory mock of the Google Drive REST API used by GoogleStorageProvider. */
const createMockDrive = () => {
  const files = new Map<string, MockFile>()
  let nextId = 0
  const tokenProvider = vi.fn(() => 'test-token')
  const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    const method = (init?.method ?? 'GET').toUpperCase()
    const auth = (init?.headers as Record<string, string> | undefined)?.Authorization
    if (auth !== 'Bearer test-token') return new Response('Unauthorized', { status: 401 })
    if (url.startsWith('https://www.googleapis.com/drive/v3/files')) {
      if (method === 'GET' && url.includes('q=')) {
        const query = decodeURIComponent(url.match(/q=([^&]+)/)![1])
        const name = query.match(/name='([^']+)'/)![1]
        const file = [...files.values()].find((f) => f.name === name)
        return new Response(JSON.stringify({ files: file ? [{ id: file.id, name: file.name }] : [] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        })
      }
      const media = url.match(/\/drive\/v3\/files\/([^/?]+)\?alt=media/)
      if (media) {
        const file = files.get(media[1])
        if (!file) return new Response('Not Found', { status: 404 })
        return new Response(file.content, { status: 200, headers: { 'Content-Type': 'text/plain' } })
      }
      const del = url.match(/\/drive\/v3\/files\/([^/?]+)/)
      if (del && method === 'DELETE') {
        if (!files.has(del[1])) return new Response('Not Found', { status: 404 })
        files.delete(del[1])
        return new Response('', { status: 200 })
      }
    } else if (url.startsWith('https://www.googleapis.com/upload/drive/v3')) {
      const patch = url.match(/\/files\/([^/?]+)\?uploadType=media/)
      if (patch) {
        const file = files.get(patch[1])
        if (!file) return new Response('Not Found', { status: 404 })
        file.content = init?.body as string
        return new Response('', { status: 200 })
      }
      if (url.includes('uploadType=multipart')) {
        const body = init?.body as string
        const nameMatch = body.match(/"name":\s*"([^"]+)"/)
        const name = nameMatch?.[1] ?? 'wallet.json'
        const data = body.split('\r\n\r\n')[2].split('\r\n--')[0]
        const id = String(++nextId)
        files.set(id, { id, name, content: data })
        return new Response(JSON.stringify({ id, name }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        })
      }
    }
    return new Response('Not Found', { status: 404 })
  })
  return { files, fetchMock, tokenProvider }
}

const voteTxHF26: HF26Transaction = {
  ref_block_num: 23679,
  ref_block_prefix: 291568045,
  expiration: '2025-11-20T07:59:08',
  operations: [
    {
      type: 'vote_operation',
      value: {
        voter: 'alice',
        author: 'someone',
        permlink: 'test-post',
        weight: 10000
      }
    }
  ],
  extensions: []
}

describe('deriveEncryptionKey', () => {
  it('derives the same key as wax password derivation', () => {
    expect(deriveEncryptionKey(PASSWORD)).toBe(PrivateKey.fromLogin('dummyaccount', PASSWORD, 'posting').toString())
  })

  it('derives the same key for unicode passwords', () => {
    expect(deriveEncryptionKey('pässwörd123')).toBe(PrivateKey.fromLogin('dummyaccount', 'pässwörd123', 'posting').toString())
  })
})

describe('wallet data format', () => {
  it('creates an empty wallet', () => {
    expect(createEmptyWalletData()).toEqual({ version: '3.0.0', hive: { accounts: {} } })
  })

  it('parses V3 data', () => {
    const data = migrateWalletData({
      version: '3.0.0',
      hive: { accounts: { alice: { roleDefinitions: { posting: { privateKey: TEST_WIF } } } } },
      generalPurposeKeys: { custom: { privateKey: TEST_WIF, description: 'custom' } }
    })
    expect(data.hive.accounts.alice.roleDefinitions.posting!.privateKey).toBe(TEST_WIF)
    expect(data.generalPurposeKeys!.custom.description).toBe('custom')
  })

  it('migrates V2 data to V3', () => {
    const data = migrateWalletData({
      version: '2.0.0',
      hive: { account: 'alice', roleDefinitions: { active: { privateKey: TEST_WIF } } },
      generalPurposeKeys: {}
    })
    expect(data.hive.accounts.alice.roleDefinitions.active!.privateKey).toBe(TEST_WIF)
    expect(data.generalPurposeKeys).toEqual({})
  })

  it('migrates V1 data to V3', () => {
    const data = migrateWalletData({
      version: '1.0.0',
      hive: { account: 'alice', roleDefinitions: { posting: { privateKey: TEST_WIF } } }
    })
    expect(data.hive.accounts.alice.roleDefinitions.posting!.privateKey).toBe(TEST_WIF)
  })

  it('ignores unknown roles and invalid entries', () => {
    const data = migrateWalletData({
      version: '3.0.0',
      hive: {
        accounts: {
          alice: {
            roleDefinitions: { posting: { privateKey: TEST_WIF }, invalid: { privateKey: 'x' }, foo: 'bar' }
          }
        }
      }
    })
    expect(Object.keys(data.hive.accounts.alice.roleDefinitions)).toEqual(['posting'])
  })

  it('rejects invalid data', () => {
    expect(() => migrateWalletData({ version: '9.9.9' })).toThrow(/Unknown wallet data version/)
    expect(() => migrateWalletData('not-object')).toThrow(/Invalid wallet data/)
    expect(() => migrateWalletData({ version: '1.0.0', hive: { account: 'alice', roleDefinitions: [] } })).not.toThrow()
  })
})

describe('GoogleStorageProvider', () => {
  let drive: ReturnType<typeof createMockDrive>

  beforeEach(() => {
    drive = createMockDrive()
    vi.stubGlobal('fetch', drive.fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('reports missing files and retrieves saved data', async () => {
    const storage = new GoogleStorageProvider(drive.tokenProvider)
    expect(await storage.exists('wallet.json')).toBe(false)
    await expect(storage.get('wallet.json')).rejects.toBeInstanceOf(StorageFileNotFoundError)

    await storage.save('wallet.json', 'data')
    expect(await storage.exists('wallet.json')).toBe(true)
    expect(await storage.get('wallet.json')).toBe('data')

    await storage.save('wallet.json', 'updated')
    expect(await storage.get('wallet.json')).toBe('updated')

    await storage.delete('wallet.json')
    expect(await storage.exists('wallet.json')).toBe(false)
    await expect(storage.delete('wallet.json')).rejects.toBeInstanceOf(StorageFileNotFoundError)
  })

  it('requests a fresh token for each API call', async () => {
    const storage = new GoogleStorageProvider(drive.tokenProvider)
    await storage.save('wallet.json', 'x')
    await storage.get('wallet.json')
    await storage.exists('wallet.json')
    expect(drive.tokenProvider).toHaveBeenCalledTimes(5)
  })

  it('throws GoogleDriveError on auth failure', async () => {
    const storage = new GoogleStorageProvider(async () => 'bad-token')
    await expect(storage.exists('wallet.json')).resolves.toBe(false)
    const error = await storage.get('wallet.json').catch((e) => e)
    expect(error).toBeInstanceOf(GoogleDriveError)
  })
})

describe('ExternalWalletProvider with a custom storage provider', () => {
  let bk: IBeekeeperInstance
  let wallet: IBeekeeperUnlockedWallet

  const aliceWif = PrivateKey.fromLogin('alice', 'pw', 'posting').toString()

  /** In-memory custom storage provider implementing AStorageProviderBase. */
  class MemoryStorage extends AStorageProviderBase {
    private readonly files = new Map<string, string>()

    async get(name: string): Promise<string> {
      const content = this.files.get(name)
      if (content === undefined) throw new StorageFileNotFoundError(`File '${name}' not found`)
      return content
    }

    async save(name: string, data: string): Promise<void> {
      this.files.set(name, data)
    }

    async delete(name: string): Promise<void> {
      if (!this.files.delete(name)) throw new StorageFileNotFoundError(`File '${name}' not found`)
    }

    async exists(name: string): Promise<boolean> {
      return this.files.has(name)
    }
  }

  beforeAll(async () => {
    bk = await createBeekeeper({ inMemory: true })
    const session = bk.createSession('test-salt')
    const created = await session.createWallet('test-wallet', 'password', true)
    wallet = created.wallet
  })

  afterAll(async () => {
    await bk.delete()
  })

  it('stores, loads and signs with any AStorageProviderBase implementation', async () => {
    const signer = new BeekeeperProvider(wallet, {}, new AiohaClient(), new SimpleEventEmitter(), sha256)
    const provider = new ExternalWalletProvider(
      {
        storage: new MemoryStorage(),
        passwordProvider: async (missing: boolean) => ({ password: PASSWORD }),
        signer,
        storageFileName: 'wallet.json'
      },
      new AiohaClient(),
      new SimpleEventEmitter()
    )

    await provider.storeKey(KeyTypes.Posting, 'alice', aliceWif)
    const login = await provider.login('alice', { msg: 'Login' })
    expect(login.success).toBe(true)
    if (!login.success) return
    expect(provider.getUser()).toBe('alice')

    const signed = await provider.signMessage('custom storage', KeyTypes.Posting)
    expect(signed.success).toBe(true)
    if (!signed.success) return
    expect(signed.publicKey).toBe(PrivateKey.from(aliceWif).createPublic().toString())
  })

  it('fails when neither storage nor tokenProvider is provided', () => {
    expect(
      () =>
        new ExternalWalletProvider(
          {
            passwordProvider: async (missing: boolean) => ({ password: PASSWORD }),
            signer: new BeekeeperProvider(wallet, {}, new AiohaClient(), new SimpleEventEmitter(), sha256)
          },
          new AiohaClient(),
          new SimpleEventEmitter()
        )
    ).toThrow(/either storage or tokenProvider is required/)
  })
})

describe('ExternalWalletProvider', () => {
  let bk: IBeekeeperInstance
  let wallet: IBeekeeperUnlockedWallet
  let drive: ReturnType<typeof createMockDrive>
  let passwordProvider: ReturnType<typeof vi.fn>

  const aliceWif = PrivateKey.fromLogin('alice', 'pw', 'posting').toString()
  const bobWif = PrivateKey.fromLogin('bob', 'pw', 'posting').toString()

  beforeAll(async () => {
    bk = await createBeekeeper({ inMemory: true })
    const session = bk.createSession('test-salt')
    const created = await session.createWallet('test-wallet', 'password', true)
    wallet = created.wallet
  })

  afterAll(async () => {
    await bk.delete()
  })

  beforeEach(() => {
    drive = createMockDrive()
    vi.stubGlobal('fetch', drive.fetchMock)
    passwordProvider = vi.fn(async (missing: boolean) => ({ password: PASSWORD }))
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  const createProvider = (opts: Partial<ExternalWalletProviderOptions> = {}) => {
    const signer = new BeekeeperProvider(wallet, {}, new AiohaClient(), new SimpleEventEmitter(), sha256)
    return new ExternalWalletProvider(
      {
        tokenProvider: drive.tokenProvider,
        passwordProvider,
        signer,
        ...opts
      },
      new AiohaClient(),
      new SimpleEventEmitter()
    )
  }

  it('stores keys encrypted in the drive wallet file', async () => {
    const provider = createProvider()
    const result = await provider.storeKey(KeyTypes.Posting, 'alice', aliceWif)
    expect(result.success).toBe(true)
    if (!result.success) return
    expect(result.result).toBe(PrivateKey.from(aliceWif).createPublic().toString())
    expect(drive.files.size).toBe(1)
    const content = [...drive.files.values()][0].content
    expect(content).not.toContain(aliceWif)
    expect(content).not.toContain('"version"')
  })

  it('writes wallet files decryptable by beekeeper directly (wax-signers-external compatible)', async () => {
    const provider = createProvider()
    await provider.storeKey(KeyTypes.Posting, 'alice', aliceWif)
    const content = [...drive.files.values()][0].content
    const pubKey = await wallet.importKey(deriveEncryptionKey(PASSWORD))
    const decrypted = await wallet.decryptData(content, pubKey)
    const data = JSON.parse(decrypted)
    expect(data.version).toBe('3.0.0')
    expect(data.hive.accounts.alice.roleDefinitions.posting.privateKey).toBe(aliceWif)
  })

  it('reads wallet files written directly by beekeeper (wax-signers-external created)', async () => {
    // simulate a wallet file created by @hiveio/wax-signers-external
    const encWif = deriveEncryptionKey(PASSWORD)
    const encPub = await wallet.importKey(encWif)
    const data = JSON.stringify({
      version: '3.0.0',
      hive: { accounts: { alice: { roleDefinitions: { posting: { privateKey: aliceWif } } } } }
    })
    drive.files.set('1', { id: '1', name: 'wallet.json', content: await wallet.encryptData(data, encPub) })

    const provider = createProvider()
    const login = await provider.login('alice', { msg: 'Login' })
    expect(login.success).toBe(true)
    if (!login.success) return
    expect(provider.getUser()).toBe('alice')
  })

  it('logs in by loading the key from the drive wallet', async () => {
    const p1 = createProvider()
    await p1.storeKey(KeyTypes.Posting, 'alice', aliceWif)
    // a fresh provider instance on the same drive simulates a page reload
    const provider = createProvider()
    const login = await provider.login('alice', { msg: 'Login' })
    expect(login.success).toBe(true)
    if (!login.success) return
    expect(login.username).toBe('alice')
    expect(provider.getUser()).toBe('alice')
    expect(passwordProvider).toHaveBeenLastCalledWith(false)

    const signed = await provider.signMessage('test message', KeyTypes.Posting)
    expect(signed.success).toBe(true)
    if (!signed.success) return
    expect(signed.publicKey).toBe(PrivateKey.from(aliceWif).createPublic().toString())
    const digest = sha256(new TextEncoder().encode('test message'))
    expect(PublicKey.fromString(signed.publicKey!).verify(Buffer.from(digest), Signature.fromString(signed.result))).toBe(true)
  })

  it('fails login when the account has no stored key', async () => {
    const provider = createProvider()
    await provider.storeKey(KeyTypes.Posting, 'alice', aliceWif)
    const login = await provider.login('bob', { msg: 'Login' })
    expect(login.success).toBe(false)
    if (login.success) return
    expect(login.errorCode).toBe(5000)
    expect(login.error).toMatch(/no posting key found for account bob/)
  })

  it('fails login when the requested key type is not stored', async () => {
    const provider = createProvider()
    await provider.storeKey(KeyTypes.Posting, 'alice', aliceWif)
    const login = await provider.login('alice', { keyType: KeyTypes.Active })
    expect(login.success).toBe(false)
  })

  it('unlocks with a cached encryption key instead of a password', async () => {
    const provider = createProvider({
      passwordProvider: (async () => ({ encryptionKey: deriveEncryptionKey(PASSWORD) })) as TStoragePasswordProvider
    })
    await provider.storeKey(KeyTypes.Posting, 'alice', aliceWif)
    const login = await provider.login('alice', {})
    expect(login.success).toBe(true)
  })

  it('creates a wallet when the file does not exist and prompts for a new password', async () => {
    const provider = createProvider()
    expect(passwordProvider).not.toHaveBeenCalled()
    await provider.storeKey(KeyTypes.Posting, 'alice', aliceWif)
    expect(passwordProvider).toHaveBeenCalledWith(true)
  })

  it('signs HF26 transactions with the loaded key', async () => {
    const provider = createProvider()
    await provider.storeKey(KeyTypes.Posting, 'alice', aliceWif)
    await provider.login('alice', {})
    const result = await provider.signTxHF26(voteTxHF26, KeyTypes.Posting)
    expect(result.success).toBe(true)
    if (!result.success) return
    expect(result.result.signatures).toHaveLength(1)
    expect(result.result.signatures[0]).toHaveLength(130)
    const { digest } = await transactionDigest(voteTxHF26, undefined, sha256)
    expect(
      PublicKey.fromString(PrivateKey.from(aliceWif).createPublic().toString()).verify(
        Buffer.from(digest),
        Signature.fromString(result.result.signatures[0])
      )
    ).toBe(true)
  })

  it('encrypts and decrypts memos with the loaded key', async () => {
    const provider = createProvider()
    await provider.storeKey(KeyTypes.Posting, 'alice', aliceWif)
    await provider.storeKey(KeyTypes.Memo, 'alice', aliceWif)
    await provider.login('alice', {})
    const pub = PrivateKey.from(aliceWif).createPublic().toString()
    const encrypted = await provider.encryptMemoWithKeys('secret message', KeyTypes.Memo, [pub])
    expect(encrypted.success).toBe(true)
    if (!encrypted.success) return
    const decrypted = await provider.decryptMemo((encrypted.result as { [k: string]: string })[pub], KeyTypes.Memo)
    expect(decrypted.success).toBe(true)
    if (!decrypted.success) return
    expect(decrypted.result).toBe('secret message')
  })

  it('discovers stored accounts and roles', async () => {
    const provider = createProvider()
    await provider.storeKey(KeyTypes.Posting, 'alice', aliceWif)
    await provider.storeKey(KeyTypes.Active, 'alice', aliceWif)
    await provider.storeKey(KeyTypes.Posting, 'bob', bobWif)

    const streamed: any[] = []
    const result = await provider.discoverAccounts((acc) => streamed.push(acc))
    expect(result.success).toBe(true)
    if (!result.success) return
    expect(Object.keys(result.result as object).sort()).toEqual(['alice', 'bob'])
    const alice = (result.result as { alice: Array<{ role: string }> }).alice
    expect(alice.map((r) => r.role).sort()).toEqual(['active', 'posting'])
    expect(streamed).toHaveLength(3)
  })

  it('removes stored keys', async () => {
    const provider = createProvider()
    await provider.storeKey(KeyTypes.Posting, 'alice', aliceWif)
    await provider.storeKey(KeyTypes.Active, 'alice', aliceWif)
    await provider.removeKey(KeyTypes.Posting, 'alice')
    expect(await provider.getStoredRoles('alice')).toEqual(['active'])
    await provider.removeKey(KeyTypes.Active, 'alice')
    expect(await provider.getStoredAccounts()).toEqual([])
    const missing = await provider.removeKey(KeyTypes.Posting, 'bob')
    expect(missing.success).toBe(false)
  })

  it('exposes the storage encryption key for caching', async () => {
    const provider = createProvider()
    expect(provider.getEncryptionKeyWif()).toBeUndefined()
    await provider.storeKey(KeyTypes.Posting, 'alice', aliceWif)
    expect(provider.getEncryptionKeyWif()).toBe(deriveEncryptionKey(PASSWORD))
  })

  it('clears the decrypted wallet on logout and re-prompts for the password', async () => {
    const provider = createProvider()
    await provider.storeKey(KeyTypes.Posting, 'alice', aliceWif)
    await provider.login('alice', {})
    expect(passwordProvider).toHaveBeenCalledTimes(1)
    await provider.logout()
    expect(provider.getUser()).toBeUndefined()
    expect(provider.getEncryptionKeyWif()).toBeUndefined()
    const login = await provider.login('alice', {})
    expect(login.success).toBe(true)
    expect(passwordProvider).toHaveBeenCalledTimes(2)
  })

  it('returns login info compatible with Aioha user switching', async () => {
    const aioha = new Aioha()
    const provider = createProvider()
    await provider.storeKey(KeyTypes.Posting, 'alice', aliceWif)
    await provider.storeKey(KeyTypes.Posting, 'bob', bobWif)
    aioha.registerCustomProvider('googledrive', provider)

    const loginAlice = await aioha.login('googledrive', 'alice', { msg: 'Login' })
    expect(loginAlice.success).toBe(true)
    expect(aioha.getCurrentProvider()).toBe('googledrive')
    expect(aioha.getCurrentUser()).toBe('alice')

    const loginBob = await aioha.login('googledrive', 'bob', { msg: 'Login' })
    expect(loginBob.success).toBe(true)
    expect(aioha.getCurrentUser()).toBe('bob')

    const info = provider.getLoginInfo()
    expect(info?.provider).toBe('googledrive')
    expect((info as any)?.keys?.[KeyTypes.Posting]).toBe(PrivateKey.from(bobWif).createPublic().toString())

    expect(aioha.switchUser('alice')).toBe(true)
    expect(aioha.getCurrentUser()).toBe('alice')
    expect(aioha.getCurrentProvider()).toBe('googledrive')

    const signed = await provider.signMessage('after switch', KeyTypes.Posting)
    expect(signed.success).toBe(true)
    if (!signed.success) return
    expect(signed.publicKey).toBe(PrivateKey.from(aliceWif).createPublic().toString())
    const digest = sha256(new TextEncoder().encode('after switch'))
    expect(PublicKey.fromString(signed.publicKey!).verify(Buffer.from(digest), Signature.fromString(signed.result))).toBe(true)
  })

  it('supports plaintext signers via setKey and dhive-based storage encryption', async () => {
    const { PlaintextKeyProvider } = await import('../src/providers/custom/plaintext.js')
    const signer = new PlaintextKeyProvider(aliceWif)
    const provider = new ExternalWalletProvider(
      { tokenProvider: drive.tokenProvider, passwordProvider, signer, storageFileName: 'wallet.json' },
      new AiohaClient(),
      new SimpleEventEmitter()
    )
    await provider.storeKey(KeyTypes.Posting, 'alice', aliceWif)
    const login = await provider.login('alice', { msg: 'Login' })
    expect(login.success).toBe(true)
    const signed = await provider.signMessage('plaintext signer', KeyTypes.Posting)
    expect(signed.success).toBe(true)
    if (!signed.success) return
    expect(signed.publicKey).toBe(PrivateKey.from(aliceWif).createPublic().toString())
    // roundtrip of the wallet file through the plaintext signer (dhive memo format)
    const content = [...drive.files.values()][0].content
    expect(signer.decryptData(content, deriveEncryptionKey(PASSWORD))).toContain('"alice"')
  })

  it('fails cleanly when the signer does not support runtime key loading', async () => {
    const provider = createProvider()
    await provider.storeKey(KeyTypes.Posting, 'alice', aliceWif)
    provider.signer = {
      ...provider.signer,
      setKey: () => {
        throw new Error('runtime key loading is not supported for this provider')
      }
    }
    const login = await provider.login('alice', {})
    expect(login.success).toBe(false)
    expect(login.errorCode).toBe(5000)
  })

  it('loads persistent logins through aioha loadAuth', async () => {
    const aioha = new Aioha()
    const provider = createProvider()
    await provider.storeKey(KeyTypes.Posting, 'alice', aliceWif)
    aioha.registerCustomProvider('googledrive', provider)
    await aioha.login('googledrive', 'alice', { msg: 'Login' })

    const info = provider.getLoginInfo()!
    provider.loadLogin('alice', info)
    expect(provider.getUser()).toBe('alice')
    // keys are lazily re-loaded from external storage for signing
    const signed = await provider.signMessage('after reload', KeyTypes.Posting)
    expect(signed.success).toBe(true)
    if (!signed.success) return
    expect(signed.publicKey).toBe(PrivateKey.from(aliceWif).createPublic().toString())
  })
})
