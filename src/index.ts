import { HiveAuth } from './providers/hiveauth.js'
import { HiveSigner } from './providers/hivesigner.js'
import { Keychain } from './providers/keychain.js'
import { ClientConfig as HiveSignerOptions } from 'hivesigner/lib/types/client-config.interface.js'
import { KeyTypes, LoginOptions, LoginResult, OperationResult, Providers } from './types.js'
import { AppMetaType } from './lib/hiveauth-wrapper.js'

export class Aioha {
  providers: {
    keychain?: Keychain
    hivesigner?: HiveSigner
    hiveauth?: HiveAuth
  }
  user?: string
  currentProvider?: Providers

  constructor() {
    this.providers = {}
  }

  registerKeychain() {
    this.providers.keychain = new Keychain()
  }

  registerHiveSigner(options: HiveSignerOptions) {
    this.providers.hivesigner = new HiveSigner(options)
  }

  registerHiveAuth(options: AppMetaType) {
    this.providers.hiveauth = new HiveAuth(options)
  }

  /**
   * Get list of registered providers
   * @returns string[]
   */
  getProviders() {
    return Object.keys(this.providers)
  }

  getCurrentProvider() {
    return this.currentProvider
  }

  getCurrentUser() {
    return this.user
  }

  isLoggedIn() {
    return this.user && this.currentProvider
  }

  async login(provider: Providers, username: string, options: LoginOptions): Promise<LoginResult> {
    if (!this.providers[provider])
      return {
        success: false,
        error: provider + ' provider is not registered'
      }
    if (provider !== 'hivesigner' && !username)
      return {
        success: false,
        error: 'username is required'
      }
    if (typeof options !== 'object')
      return {
        success: false,
        error: 'options are required'
      }
    const result = await this.providers[provider]!.login(username, options)
    this.user = username
    this.currentProvider = provider
    localStorage.setItem('aiohaUsername', this.user)
    localStorage.setItem('aiohaProvider', this.currentProvider)
    return result
  }

  async logout(): Promise<void> {
    if (!this.user || !this.currentProvider) throw new Error('Not logged in')
    await this.providers[this.currentProvider]!.logout()
    delete this.user
    delete this.currentProvider
    localStorage.removeItem('aiohaUsername')
    localStorage.removeItem('aiohaProvider')
  }

  loadAuth(): boolean {
    const user = localStorage.getItem('aiohaUsername')
    const provider = localStorage.getItem('aiohaProvider') as Providers | null
    if (!provider || !user || !this.providers[provider] || !this.providers[provider]!.loadAuth()) return false
    this.user = user
    this.currentProvider = provider
    return true
  }

  async decryptMemo(memo: string, keyType: KeyTypes): Promise<OperationResult> {
    if (!this.isLoggedIn()) throw new Error('Not logged in')
    return await this.providers[this.getCurrentProvider()!]!.decryptMemo(this.getCurrentUser()!, memo, keyType)
  }
}
