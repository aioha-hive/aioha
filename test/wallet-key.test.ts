import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import createBeekeeper, { type IBeekeeperInstance, type IBeekeeperUnlockedWallet } from '@hiveio/beekeeper'
import { PrivateKey } from '@hiveio/dhive'
import { sha256 } from '@noble/hashes/sha2.js'
import { PlaintextKeyProvider } from '../src/providers/custom/plaintext.js'
import { BeekeeperProvider } from '../src/providers/custom/beekeeper.js'
import { AiohaClient } from '../src/rpc.js'
import { SimpleEventEmitter } from '../src/lib/event-emitter.js'
import type { WalletKeyProvider } from '../src/providers/provider.js'

const ENCRYPTION_WIF = PrivateKey.fromLogin('dummyaccount', 'wallet-password', 'posting').toString()
const CONTENT = JSON.stringify({ version: '3.0.0', hive: { accounts: { alice: { roleDefinitions: {} } } } })

describe('WalletKeyProvider', () => {
  let bk: IBeekeeperInstance
  let wallet: IBeekeeperUnlockedWallet
  let plaintext: PlaintextKeyProvider
  let beekeeper: BeekeeperProvider

  beforeAll(async () => {
    bk = await createBeekeeper({ inMemory: true })
    const session = bk.createSession('test-salt')
    const created = await session.createWallet('test-wallet', 'password', true)
    wallet = created.wallet
    plaintext = new PlaintextKeyProvider()
    beekeeper = new BeekeeperProvider(wallet, {}, new AiohaClient(), new SimpleEventEmitter(), sha256)
  })

  afterAll(async () => {
    await bk.delete()
  })

  it('both providers expose the interface methods', async () => {
    const providers: WalletKeyProvider[] = [plaintext, beekeeper]
    const publicKey = PrivateKey.from(ENCRYPTION_WIF).createPublic().toString()
    for (const provider of providers) {
      expect(await provider.deriveWalletEncryptionKey('wallet-password')).toBe(ENCRYPTION_WIF)
      expect(await provider.getPublicKey(ENCRYPTION_WIF)).toBe(publicKey)
      const encrypted = await provider.encryptWalletData(CONTENT, ENCRYPTION_WIF)
      expect(encrypted).not.toContain('"version"')
      expect(await provider.decryptWalletData(encrypted, ENCRYPTION_WIF)).toBe(CONTENT)
    }
  })

  it('wallet data encrypted by one signer can be decrypted by the other', async () => {
    const byPlaintext = await plaintext.encryptWalletData(CONTENT, ENCRYPTION_WIF)
    expect(await beekeeper.decryptWalletData(byPlaintext, ENCRYPTION_WIF)).toBe(CONTENT)

    const byBeekeeper = await beekeeper.encryptWalletData(CONTENT, ENCRYPTION_WIF)
    expect(await plaintext.decryptWalletData(byBeekeeper, ENCRYPTION_WIF)).toBe(CONTENT)
  })

  it('rejects decryption with the wrong wallet key', async () => {
    const encrypted = await plaintext.encryptWalletData(CONTENT, ENCRYPTION_WIF)
    const wrongKey = PrivateKey.fromLogin('dummyaccount', 'wrong-password', 'posting').toString()
    await expect(plaintext.decryptWalletData(encrypted, wrongKey)).rejects.toThrow()
    await expect(beekeeper.decryptWalletData(encrypted, wrongKey)).rejects.toThrow()
  })
})
