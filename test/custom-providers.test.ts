import { describe, it, expect, beforeEach } from 'vitest'
import { Aioha } from '../src/index.js'
import { AiohaProviderBase } from '../src/providers/provider.js'
import { KeyTypes, Providers } from '../src/types.js'
import type {
  LoginOptions,
  LoginOptionsNI,
  LoginResult,
  OperationResult,
  OperationResultObj,
  PersistentLogin,
  SignOperationResult,
  SignOperationResultObj
} from '../src/types.js'
import type { Operation, Transaction } from '@hiveio/dhive'

class FakeProvider extends AiohaProviderBase {
  readonly name: string
  private user?: string
  private info?: PersistentLogin

  constructor(name: string) {
    super('https://api.example.com')
    this.name = name
  }

  async login(username: string, _options: LoginOptions): Promise<LoginResult> {
    this.user = username
    this.info = { provider: this.name, pubKey: 'STM-fake' }
    return { success: true, provider: this.name, result: '', username, publicKey: 'STM-fake' }
  }
  async loginAndDecryptMemo(username: string, options: LoginOptions): Promise<LoginResult> {
    return this.login(username, options)
  }
  loginNonInteractive(username: string, _options: LoginOptionsNI): LoginResult {
    this.user = username
    this.info = { provider: this.name, pubKey: 'STM-fake' }
    return { success: true, provider: this.name, result: '', username, publicKey: 'STM-fake' }
  }
  async logout(): Promise<void> {
    this.user = undefined
    this.info = undefined
  }
  loadAuth(username: string): boolean {
    this.user = username
    this.info = { provider: this.name, pubKey: 'STM-fake' }
    return true
  }
  getUser(): string | undefined {
    return this.user
  }
  getLoginInfo(): PersistentLogin | undefined {
    return this.info
  }
  loadLogin(username: string, info: PersistentLogin): boolean {
    this.user = username
    this.info = info
    return true
  }
  async encryptMemo(): Promise<OperationResult> {
    return { success: true, result: '#enc' }
  }
  async encryptMemoWithKeys(): Promise<OperationResultObj> {
    return { success: true, result: {} }
  }
  async decryptMemo(): Promise<OperationResult> {
    return { success: true, result: 'plain' }
  }
  async signMessage(): Promise<OperationResult> {
    return { success: true, result: 'sig' }
  }
  async signTx(tx: Transaction, _keyType: KeyTypes): Promise<SignOperationResultObj> {
    return { success: true, result: { ...tx, signatures: ['sig'] } as any }
  }
  async signAndBroadcastTx(_tx: Operation[], _keyType: KeyTypes): Promise<SignOperationResult> {
    return { success: true, result: 'tx-id' }
  }
}

describe('Multiple custom providers', () => {
  let aioha: Aioha

  beforeEach(() => {
    aioha = new Aioha()
  })

  it('legacy registerCustomProvider(impl) registers under Providers.Custom', async () => {
    const impl = new FakeProvider(Providers.Custom)
    aioha.registerCustomProvider(impl)
    expect(aioha.isProviderRegistered(Providers.Custom)).toBe(true)
    expect(aioha.getProviders()).toContain(Providers.Custom)

    const result = await aioha.login(Providers.Custom, 'alice', {})
    expect(result.success).toBe(true)
    expect(aioha.getCurrentProvider()).toBe(Providers.Custom)
    expect(aioha.getCurrentUser()).toBe('alice')
  })

  it('named form registers a custom provider under the given name', async () => {
    const impl = new FakeProvider('beekeeper')
    aioha.registerCustomProvider('beekeeper', impl)
    expect(aioha.isProviderRegistered('beekeeper')).toBe(true)

    const result = await aioha.login('beekeeper', 'alice', {})
    expect(result.success).toBe(true)
    if (result.success) expect(result.provider).toBe('beekeeper')
    expect(aioha.getCurrentProvider()).toBe('beekeeper')
  })

  it('named form bypasses keyType requirement', async () => {
    aioha.registerCustomProvider('beekeeper', new FakeProvider('beekeeper'))
    const result = await aioha.login('beekeeper', 'alice', {})
    expect(result.success).toBe(true)
  })

  it('throws when registering a built-in provider name', () => {
    const impl = new FakeProvider('keychain')
    expect(() => aioha.registerCustomProvider('keychain', impl)).toThrow(/reserved/)
  })

  it('throws when registering a name that is already registered', () => {
    aioha.registerCustomProvider('beekeeper', new FakeProvider('beekeeper'))
    expect(() => aioha.registerCustomProvider('beekeeper', new FakeProvider('beekeeper'))).toThrow(/already registered/)
  })

  it('throws when name is empty', () => {
    expect(() => aioha.registerCustomProvider('', new FakeProvider('x'))).toThrow(/non-empty/)
  })

  it('legacy "custom" name is not reserved against the named form', () => {
    aioha.registerCustomProvider('custom', new FakeProvider(Providers.Custom))
    expect(aioha.isProviderRegistered(Providers.Custom)).toBe(true)
  })

  it('two custom providers can be registered and logged in concurrently', async () => {
    aioha.registerCustomProvider('beekeeper', new FakeProvider('beekeeper'))
    aioha.registerCustomProvider('hardware-x', new FakeProvider('hardware-x'))

    const r1 = await aioha.login('beekeeper', 'alice', {})
    expect(r1.success).toBe(true)
    expect(aioha.getCurrentProvider()).toBe('beekeeper')
    expect(aioha.getCurrentUser()).toBe('alice')

    const r2 = await aioha.login('hardware-x', 'bob', {})
    expect(r2.success).toBe(true)
    expect(aioha.getCurrentProvider()).toBe('hardware-x')
    expect(aioha.getCurrentUser()).toBe('bob')

    const others = aioha.getOtherLogins()
    expect(others.alice).toBe('beekeeper')
  })

  it('switchUser restores the right custom provider', async () => {
    aioha.registerCustomProvider('beekeeper', new FakeProvider('beekeeper'))
    aioha.registerCustomProvider('hardware-x', new FakeProvider('hardware-x'))

    await aioha.login('beekeeper', 'alice', {})
    await aioha.login('hardware-x', 'bob', {})

    const switched = aioha.switchUser('alice')
    expect(switched).toBe(true)
    expect(aioha.getCurrentProvider()).toBe('beekeeper')
    expect(aioha.getCurrentUser()).toBe('alice')
    expect(aioha.getOtherLogins().bob).toBe('hardware-x')
  })

  it('deregisterProvider works for custom names while logged out', () => {
    aioha.registerCustomProvider('beekeeper', new FakeProvider('beekeeper'))
    expect(aioha.deregisterProvider('beekeeper')).toBe(true)
    expect(aioha.isProviderRegistered('beekeeper')).toBe(false)
  })

  it('deregisterProvider blocks while logged in (existing semantics)', async () => {
    aioha.registerCustomProvider('beekeeper', new FakeProvider('beekeeper'))
    await aioha.login('beekeeper', 'alice', {})
    expect(aioha.deregisterProvider('beekeeper')).toBe(false)
  })

  it('getProviders includes both built-in and custom names', () => {
    aioha.registerCustomProvider('beekeeper', new FakeProvider('beekeeper'))
    aioha.registerCustomProvider('hardware-x', new FakeProvider('hardware-x'))
    const list = aioha.getProviders()
    expect(list).toContain('beekeeper')
    expect(list).toContain('hardware-x')
  })

  it('login on an unregistered name fails with 4201', async () => {
    const result = await aioha.login('not-registered', 'alice', {})
    expect(result.success).toBe(false)
    if (!result.success) expect(result.errorCode).toBe(4201)
  })
})
