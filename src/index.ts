import { CommentOptionsOperation, Operation, Transaction, VoteOperation } from '@hiveio/dhive'
import { HiveAuth } from './providers/hiveauth.js'
import { HiveSigner } from './providers/hivesigner.js'
import { Keychain } from './providers/keychain.js'
import { Ledger } from './providers/ledger.js'
import { PeakVault } from './providers/peakvault.js'
import { ClientConfig as HiveSignerOptions } from './lib/hivesigner-types.js'
import {
  Asset,
  Events,
  KeyTypes,
  LoginOptions,
  LoginResult,
  OperationResult,
  SignOperationResult,
  SignOperationResultObj,
  Providers,
  VoteParams,
  LoginOptionsNI,
  OperationResultObj,
  PersistentLogins,
  PersistentLogin,
  PersistentLoginProvs,
  VscStakeType,
  AccountDiscStream,
  VscTxIntent,
  SignOperationResultObjHF26,
  DiscoverOptions
} from './types.js'
import { SimpleEventEmitter } from './lib/event-emitter.js'
import { AppMetaType } from './lib/hiveauth-wrapper.js'
import { decode, resolveTransaction, ResolveResult } from './lib/hive-uri.js'
import { createVote } from './opbuilder.js'
import { DEFAULT_API, FALLBACK_APIS, getAccounts, call } from './rpc.js'
import { AiohaOperations, AiohaProviderBase, DEFAULT_VSC_NET_ID } from './providers/provider.js'
export { constructTxHeader } from './opbuilder.js'
export { broadcastTx, call, hivePerVests } from './rpc.js'
export { Asset, KeyTypes, Providers, VscStakeType, PersistentLoginProvs } from './types.js'
import { AiohaRpcError, RequestArguments } from './jsonrpc/eip1193-types.js'
import { ViewOnly } from './providers/view-only.js'
import { MetaMaskSnap } from './providers/metamask.js'
import { HF26Operation, HF26Transaction } from './lib/hf26-types.js'
import { error, loginError } from './lib/errors.js'
export { WaxAiohaSigner } from './lib/wax-signer.js'

interface SetupOptions {
  hivesigner?: HiveSignerOptions
  hiveauth?: AppMetaType
  metamasksnap?: boolean
}

const notLoggedInResult = error(4900, 'Not logged in')
const noMemoAllowResult = error(5005, 'key type cannot be memo')

const NON_BROWSER_ERR = 'Provider only available in browser env'

/**
 * Main Aioha class.
 */
export class Aioha implements AiohaOperations {
  private providers: {
    keychain?: Keychain
    hivesigner?: HiveSigner
    hiveauth?: HiveAuth
    ledger?: Ledger
    peakvault?: PeakVault
    metamasksnap?: MetaMaskSnap
    viewonly?: ViewOnly
    custom?: AiohaProviderBase
  }
  private currentProvider?: Providers
  private otherLogins: PersistentLogins
  private eventEmitter: SimpleEventEmitter
  protected publicKey?: string
  private vscNetId = DEFAULT_VSC_NET_ID
  private api = DEFAULT_API
  private fallbackApis = FALLBACK_APIS

  constructor(api?: string, fallbackApis?: string[]) {
    this.providers = {}
    if (api) {
      this.setApi(api, fallbackApis)
    }
    this.otherLogins = {}
    this.eventEmitter = new SimpleEventEmitter()
  }

  private isBrowser(): boolean {
    return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined'
  }

  private setPublicKey(newPubKey?: string) {
    if (typeof newPubKey !== 'undefined') {
      this.publicKey = newPubKey
      if (this.isBrowser()) localStorage.setItem('aiohaPubKey', newPubKey)
    } else {
      delete this.publicKey
      if (this.isBrowser()) localStorage.removeItem('aiohaPubKey')
    }
  }

  /**
   * Get last public key returned from `login()`.
   * @returns {string | undefined} STM-prefixed Hive public key
   */
  getPublicKey(): string | undefined {
    return this.publicKey
  }

  setup(options?: SetupOptions) {
    if (!this.isLoggedIn()) {
      if (!options) options = {}
      if (!options.hiveauth)
        options.hiveauth = {
          name: 'Aioha Generic App'
        }

      this.registerKeychain()
      this.registerLedger()
      this.registerPeakVault()
      this.registerMetaMaskSnap()
      this.registerHiveAuth(options.hiveauth)
      if (options.hivesigner) this.registerHiveSigner(options.hivesigner)
      this.loadAuth()
    }
  }

  /**
   * Register Hive Keychain provider.
   */
  registerKeychain() {
    if (!this.isBrowser()) throw new Error(NON_BROWSER_ERR)
    this.providers.keychain = new Keychain(this.eventEmitter)
  }

  /**
   * Register HiveSigner provider.
   * @param {HiveSignerOptions} options HiveSigner instantiation options. See https://github.com/ecency/hivesigner-sdk#init-client for details.
   */
  registerHiveSigner(options: HiveSignerOptions) {
    if (!this.isBrowser()) throw new Error(NON_BROWSER_ERR)
    this.providers.hivesigner = new HiveSigner(this.api, this.eventEmitter, options)
  }

  /**
   * Register HiveAuth provider.
   * @param {AppMetaType} options HiveAuth app metadata.
   * @param {string} options.name App name
   * @param {string} [options.description] Description of the app
   * @param {string} [options.icon] URL to app icon
   */
  registerHiveAuth(options: AppMetaType) {
    if (!this.isBrowser()) throw new Error(NON_BROWSER_ERR)
    this.providers.hiveauth = new HiveAuth(this.api, this.eventEmitter, options)
  }

  /**
   * Register Ledger provider.
   */
  registerLedger() {
    // the provider defined assumes browser env although we could make it work on nodejs
    if (!this.isBrowser()) throw new Error(NON_BROWSER_ERR)
    this.providers.ledger = new Ledger(this.api, this.eventEmitter)
  }

  /**
   * Register Peak Vault provider.
   */
  registerPeakVault() {
    if (!this.isBrowser()) throw new Error(NON_BROWSER_ERR)
    this.providers.peakvault = new PeakVault(this.eventEmitter)
  }

  registerMetaMaskSnap() {
    if (!this.isBrowser()) throw new Error(NON_BROWSER_ERR)
    this.providers.metamasksnap = new MetaMaskSnap(this.api, this.eventEmitter)
    return this.providers.metamasksnap.initProvider()
  }

  /**
   * Register a view only provider.
   */
  registerViewOnly() {
    this.providers.viewonly = new ViewOnly()
  }

  /**
   * Register a custom provider for use in Aioha.
   * @param {AiohaProviderBase} providerImpl An instance of the provider class that implements [AiohaProviderBase](https://github.com/aioha-hive/aioha/blob/main/src/providers/provider.ts).
   */
  registerCustomProvider(providerImpl: AiohaProviderBase) {
    this.providers.custom = providerImpl
    this.providers.custom.setEventEmitter(this.eventEmitter)
  }

  /**
   * Deregister a provider. Must be logged out or unauthenticated.
   * @param provider Provider to deregister
   * @returns Boolean of whether the provider has been successfully deregistered
   */
  deregisterProvider(provider: Providers) {
    if (!this.providers[provider] || this.isLoggedIn()) return false
    delete this.providers[provider]
    return true
  }

  /**
   * Checks if a provider is registered
   * @param provider A Providers enum value
   * @returns boolean of whether the specified provider is registered
   */
  isProviderRegistered(provider: Providers): boolean {
    return !!this.providers[provider]
  }

  /**
   * Checks if a provider is registered and ready to use (i.e. Keychain provider is registered and browser extension installed by user)
   * @param provider A Providers enum value
   * @returns boolean of whether the specified provider is ready to use by the user
   */
  isProviderEnabled(provider: Providers): boolean {
    switch (provider) {
      case Providers.Keychain:
        return !!this.providers.keychain && Keychain.isInstalled()
      case Providers.PeakVault:
        return !!this.providers.peakvault && this.providers.peakvault.isInstalled()
      case Providers.MetaMaskSnap:
        return !!this.providers.metamasksnap && this.providers.metamasksnap.isInstalled()
      default:
        return !!this.providers[provider]
    }
  }

  /**
   * Get list of registered providers
   * @returns string[]
   */
  getProviders() {
    return Object.keys(this.providers)
  }

  /**
   * Get the current provider of the authenticated Hive account.
   * @returns The current provider
   */
  getCurrentProvider() {
    return this.currentProvider
  }

  /**
   * Get the username of the authenticated Hive account.
   * @returns The current username
   */
  getCurrentUser() {
    return !!this.currentProvider ? this.providers[this.currentProvider]!.getUser() : undefined
  }

  /**
   * Returns a boolean value of whether a user is logged in or not.
   * @returns {boolean}
   */
  isLoggedIn(): boolean {
    return !!this.currentProvider
  }

  /**
   * List other connected accounts that are currently inactive.
   * @returns Mapping of username -> provider.
   */
  getOtherLogins(): PersistentLoginProvs {
    const result: PersistentLoginProvs = {}
    for (let u in this.otherLogins) result[u] = this.otherLogins[u].provider
    return result
  }

  /**
   * Get expiration for a login.
   * @param username Login username
   * @returns the expiration timestamp in milliseconds if any
   */
  getLoginExpiration(username: string): number | undefined {
    if (this.getCurrentUser() === username) {
      return this.getPI().getLoginInfo()?.exp
    } else if (!!this.otherLogins[username]) {
      return this.otherLogins[username].exp
    }
  }

  /**
   * Get instance of the current provider. Throws an error if not logged in.
   * @returns Instance of the provider that implements AiohaProviderBase
   */
  getCurrentProviderInstance(): AiohaProviderBase {
    if (!this.currentProvider) throw new Error('Not logged in')
    return this.providers[this.currentProvider]!
  }

  /**
   * Shorthand for `getCurrentProviderInstance()`.
   */
  getPI = this.getCurrentProviderInstance

  /**
   * Set Hive API URL used by some providers for API calls.
   * @param api Hive API URL
   */
  setApi(api: string, fallbackApis?: string[]): void {
    if (!api.startsWith('http://') && !api.startsWith('https://')) throw new Error('api must start from http:// or https://')
    this.api = api
    if (fallbackApis) this.fallbackApis = fallbackApis
    for (const p in this.providers) this.providers[p as Providers]?.setApi(api)
  }

  /**
   * Get current API endpoints(s).
   * @returns Array of API endpoints(s), where the first item is the main endpoint and the remaining are fallbacks.
   */
  getApi(): string[] {
    return [this.api, ...this.fallbackApis]
  }

  private setUserAndProvider(username: string, provider: Providers, newPubKey?: string) {
    const previouslyConnected = this.isLoggedIn()
    this.currentProvider = provider
    if (this.isBrowser()) {
      localStorage.setItem('aiohaUsername', this.getCurrentUser()!)
      localStorage.setItem('aiohaProvider', this.currentProvider)
    }
    this.setPublicKey(newPubKey)
    if (this.otherLogins[username]) delete this.otherLogins[username]
    !previouslyConnected ? this.eventEmitter.emit('connect') : this.eventEmitter.emit('account_changed')
  }

  private addOtherLogin(username: string, loginItm: PersistentLogin) {
    this.otherLogins[username] = loginItm
    if (this.isBrowser()) localStorage.setItem('aiohaOtherLogins', JSON.stringify(this.otherLogins))
  }

  /**
   * Remove an inactive but authenticated user.
   * @param username Username to remove
   * @returns The removed login details.
   */
  removeOtherLogin(username: string, emit: boolean = true): PersistentLogin {
    if (!this.otherLogins[username]) throw new Error('Cannot remove non-existent login')
    const popped = this.otherLogins[username]
    delete this.otherLogins[username]
    if (this.isBrowser()) localStorage.setItem('aiohaOtherLogins', JSON.stringify(this.otherLogins))
    if (emit) this.eventEmitter.emit('account_changed')
    return popped
  }

  private loginCheck(provider: Providers, username: string, options: LoginOptions | LoginOptionsNI): LoginResult {
    if (this.getCurrentUser() === username || this.otherLogins[username]) return loginError(4901, 'Already logged in')
    if (!this.providers[provider]) return loginError(4201, provider + ' provider is not registered')
    if (!username && provider !== Providers.HiveSigner) return loginError(5002, 'username is required')
    if (typeof options !== 'object') return loginError(5003, 'options are required')
    if (
      !options.keyType &&
      provider !== Providers.HiveSigner &&
      provider !== Providers.Ledger &&
      provider !== Providers.ViewOnly &&
      provider !== Providers.Custom
    )
      return loginError(5003, 'keyType options are required', provider)
    return {
      provider: Providers.Custom,
      success: true,
      result: '',
      username
    }
  }

  /**
   * EIP-1193 style JSON-RPC request.
   *
   * See [EIP-1193](https://eips.ethereum.org/EIPS/eip-1193) for spec details.
   *
   * See [Aioha RPC specs](https://aioha.dev/docs/core/jsonrpc) for Aioha RPC methods.
   * @param {RequestArguments} args JSON-RPC call body
   * @returns RPC call result
   * @deprecated Use AiohaJsonRpc class in extras instead. Will be removed in v2.
   */
  async request(args: RequestArguments): Promise<unknown> {
    // 0. pre-validation
    if (typeof args !== 'object' || typeof args.method !== 'string' || (args.params && typeof args.params !== 'object'))
      return Promise.reject(new AiohaRpcError(-32600, 'Invalid request'))

    // 1. Provider specific methods
    if (this.isLoggedIn()) {
      try {
        const result = await this.getPI().request(args)
        return result
      } catch (e: any) {
        if (e.name !== 'AiohaRpcError' || e.code !== 4200) throw e
      }
    }

    // 2. aioha_api.* getter methods
    if (args.method.startsWith('aioha_api.')) {
      throw new AiohaRpcError(4200, 'Use AiohaJsonRpc class in extras instead')
    }

    // 4. Hive API call
    const apiRequest = await call(args.method, args.params, this.api, this.fallbackApis)
    if (apiRequest.error) throw new Error(apiRequest.error)
    else return apiRequest.result
  }

  /**
   * Discover accounts that are available to connect for the provider.
   * @param provider The provider which must be registered already.
   * @param stream Stream of accounts discovered
   * @returns Object mapping available account username -> details. The details type may be dependent on the selected provider.
   */
  async discoverAccounts(
    provider: Providers,
    stream?: AccountDiscStream,
    options?: DiscoverOptions
  ): Promise<OperationResultObj> {
    if (!this.providers[provider]) return error(4201, provider + ' provider is not registered')
    return await this.providers[provider].discoverAccounts(stream, options)
  }

  /**
   * Switch to another authenticated user.
   * @param username Logged in username to switch to.
   * @returns boolean of whether operation is successful or not.
   */
  switchUser(username: string): boolean {
    if (!this.otherLogins[username] || !this.providers[this.otherLogins[username].provider]) return false
    const prevUser = this.getCurrentUser()
    if (this.isLoggedIn()) {
      if (this.getCurrentUser() === username) return false
      const current = this.getPI().getLoginInfo()
      if (!current) throw new Error('Failed to get current login info') // this should not happen
      this.addOtherLogin(this.getCurrentUser()!, current)
    }
    const nextUser = this.removeOtherLogin(username, false)
    const loaded = this.providers[nextUser.provider]!.loadLogin(username, nextUser)
    if (!loaded) {
      if (prevUser) {
        const prev = this.removeOtherLogin(prevUser)
        this.providers[prev.provider]!.loadLogin(prevUser, prev)
      }
      return false
    }
    this.setUserAndProvider(username, nextUser.provider, nextUser.pubKey)
    return true
  }

  /**
   * Alias for `login()`.
   */
  connect = this.login

  /**
   * Alias for `logout()`.
   */
  disconnect = this.logout

  /**
   * Authenticate a Hive account by requesting a message signature. Also known as *Connect Wallet*.
   * @param {string} provider The provider to use for auth which must be registered already.
   * @param {string} username Hive username
   * @param {LoginOptions} options Login options including message to sign and provider specific options.
   * @returns The login result.
   */
  async login(provider: Providers, username: string, options: LoginOptions): Promise<LoginResult> {
    const check = this.loginCheck(provider, username, options)
    if (!check.success) return check
    let prevLogin: PersistentLogin | undefined, prevUser: string | undefined
    if (this.isLoggedIn()) {
      prevLogin = this.getPI().getLoginInfo()!
      prevUser = this.getCurrentUser()!
    }
    const result = await this.providers[provider]!.login(username, options)
    if (result.success) {
      if (prevLogin && prevUser && prevUser !== username) this.addOtherLogin(prevUser, prevLogin)
      this.setUserAndProvider(result.username ?? username, provider, result.publicKey)
    }
    return result
  }

  /**
   * Authenticate a Hive account by requesting a memo to be decrypted. Memo is to be decrypted with @hivesigner posting key for HiveSigner provider.
   * @param {string} provider The provider to use for auth which must be registered already.
   * @param {string} username Hive username
   * @param {LoginOptions} options Login options including memo to decrypt.
   * @returns The login result.
   */
  async loginAndDecryptMemo(provider: Providers, username: string, options: LoginOptions): Promise<LoginResult> {
    const check = this.loginCheck(provider, username, options)
    if (!check.success) return check
    if (!options || typeof options.msg !== 'string' || !options.msg.startsWith('#'))
      return loginError(5004, 'memo to decode must start with #')
    let prevLogin: PersistentLogin | undefined, prevUser: string | undefined
    if (this.isLoggedIn()) {
      prevLogin = this.getPI().getLoginInfo()!
      prevUser = this.getCurrentUser()!
    }
    const result = await this.providers[provider]!.loginAndDecryptMemo(username, options)
    if (result.success) {
      if (prevLogin && prevUser && prevUser !== username) this.addOtherLogin(prevUser, prevLogin)
      this.setUserAndProvider(result.username ?? username, provider)
    }
    return result
  }

  /**
   * Non-interactive login when auth info is already available (i.e. one-click login).
   * @param provider The provider to use for auth which must be registered already.
   * @param username Hive username
   * @param options Non-interactive login options
   * @returns The login result with result being an empty-string.
   */
  loginNonInteractive(provider: Providers, username: string, options: LoginOptionsNI): LoginResult {
    if (this.isLoggedIn()) throw new Error('already logged in')
    const check = this.loginCheck(provider, username, options)
    if (!check.success) return check
    if (!options.ignorePersistence) {
      const authLoaded = this.loadAuth()
      if (authLoaded)
        return {
          success: true,
          provider: this.getCurrentProvider()!,
          username: this.getCurrentUser()!,
          result: ''
        }
    }
    const result = this.providers[provider]!.loginNonInteractive(username, options)
    if (result.success) {
      this.setUserAndProvider(result.username ?? username, provider, result.publicKey)
    }
    return result
  }

  /**
   * Logout the current authenticated user. Also known as *Disconnect Wallet*.
   */
  async logout(): Promise<void> {
    if (!!this.currentProvider) {
      await this.providers[this.currentProvider]!.logout()
    }
    this.handleLogout()
  }

  /**
   * Logout all users.
   */
  async logoutAll(): Promise<void> {
    this.otherLogins = {}
    if (this.isBrowser()) {
      localStorage.removeItem('aiohaOtherLogins')
    }
    await this.logout() // logout current user. this will emit a disconnect event.
  }

  private handleLogout() {
    delete this.currentProvider
    if (this.isBrowser()) {
      localStorage.removeItem('aiohaUsername')
      localStorage.removeItem('aiohaProvider')
    }
    this.setPublicKey()
    this.eventEmitter.emit('disconnect')
  }

  /**
   * Load persistent login details from local storage. Only works in browsers.
   * @returns boolean of whether an authentication has been loaded or not.
   */
  loadAuth(): boolean {
    if (this.isLoggedIn()) return true
    if (this.isBrowser()) {
      try {
        const loadedOtherLogins = localStorage.getItem('aiohaOtherLogins')
        if (loadedOtherLogins) this.otherLogins = JSON.parse(loadedOtherLogins) as PersistentLogins
        for (let u in this.otherLogins) {
          if (typeof this.otherLogins[u].exp === 'number' && new Date().getTime() >= this.otherLogins[u].exp) {
            delete this.otherLogins[u]
          }
        }
      } catch {}
      const user = localStorage.getItem('aiohaUsername')
      const provider = localStorage.getItem('aiohaProvider') as Providers | null
      const publicKey = localStorage.getItem('aiohaPubKey')
      if (!provider || !user || !this.providers[provider] || !this.providers[provider]!.loadAuth(user)) return false
      if (publicKey) this.setPublicKey(publicKey)
      this.currentProvider = provider
      this.eventEmitter.emit('connect')
      return true
    }
    return false
  }

  /**
   * Encrypt a memo for another user.
   * @param message Memo to encrypt
   * @param keyType Sender key type for the encryption
   * @param recipient Recipient username
   * @returns Encryption result with encrypted message if successful.
   */
  async encryptMemo(message: string, keyType: KeyTypes, recipient: string): Promise<OperationResult> {
    if (!this.isLoggedIn()) return notLoggedInResult
    if (!message.startsWith('#')) message = '#' + message
    return await this.getPI().encryptMemo(message, keyType, recipient)
  }

  /**
   * Encrypt a memo using receipient public keys.
   * @param message Memo to encrypt
   * @param keyType Sender key type for the encryption
   * @param recipientKeys List of recipient public keys
   * @returns Encryption result with encrypted messages if successful.
   */
  async encryptMemoWithKeys(message: string, keyType: KeyTypes, recipientKeys: string[]): Promise<OperationResultObj> {
    if (!this.isLoggedIn()) return notLoggedInResult
    if (!message.startsWith('#')) message = '#' + message
    return await this.getPI().encryptMemoWithKeys(
      message,
      keyType,
      recipientKeys.map((v) => v.trim())
    )
  }

  /**
   * Decrypt a memo.
   * @param memo Memo to decrypt. Memos are to be decrypted with `hivesigner` posting key when the current provider is HiveSigner.
   * @param keyType Key type to be used to decrypt the memo. Must be `posting` for HiveSigner provider.
   * @returns Decryption result
   */
  async decryptMemo(memo: string, keyType: KeyTypes): Promise<OperationResult> {
    if (!this.isLoggedIn()) return notLoggedInResult
    return await this.getPI().decryptMemo(memo, keyType)
  }

  /**
   * Sign a message.
   * @param message Message to be signed
   * @param keyType Key type to be used to sign the message
   * @returns Message signing result
   */
  async signMessage(message: string, keyType: KeyTypes): Promise<OperationResult> {
    if (!this.isLoggedIn()) return notLoggedInResult
    return await this.getPI().signMessage(message, keyType)
  }

  /**
   * Sign a full transaction with headers without broadcasting it.
   * @param tx The full unsigned transaction containing both headers and operation body
   * @param keyType Key type to be used to sign the transaction.
   * @returns Transaction signing result
   */
  async signTx(tx: Transaction, keyType: KeyTypes): Promise<SignOperationResultObj> {
    if (!this.isLoggedIn()) return notLoggedInResult
    else if (keyType === KeyTypes.Memo) return noMemoAllowResult
    return await this.getPI().signTx(tx, keyType)
  }

  /**
   * Sign and broadcast a transaction.
   * @param tx List of operations for the transaction.
   * @param keyType Key type to be used to sign the transaction.
   * @returns Transaction result
   */
  async signAndBroadcastTx(tx: Operation[], keyType: KeyTypes): Promise<OperationResult> {
    if (!this.isLoggedIn()) return notLoggedInResult
    else if (keyType === KeyTypes.Memo) return noMemoAllowResult
    return await this.getPI().signAndBroadcastTx(tx, keyType)
  }

  /**
   * Sign a full HF26 serialized transaction with headers without broadcasting it.
   * @param tx The full unsigned transaction containing both headers and operation body
   * @param keyType Key type to be used to sign the transaction.
   * @returns Transaction signing result
   */
  async signTxHF26(tx: HF26Transaction, keyType: KeyTypes): Promise<SignOperationResultObjHF26> {
    if (!this.isLoggedIn()) return notLoggedInResult
    else if (keyType === KeyTypes.Memo) return noMemoAllowResult
    return await this.getPI().signTxHF26(tx, keyType)
  }

  /**
   * Sign and broadcast a HF26 serialized transaction.
   * @param tx List of operations for the transaction.
   * @param keyType Key type to be used to sign the transaction.
   * @returns Transaction result
   */
  async signAndBroadcastTxHF26(tx: HF26Operation[], keyType: KeyTypes): Promise<SignOperationResult> {
    if (!this.isLoggedIn()) return notLoggedInResult
    else if (keyType === KeyTypes.Memo) return noMemoAllowResult
    return await this.getPI().signAndBroadcastTxHF26(tx, keyType)
  }

  /**
   * Sign and broadcast a [hive-uri](https://gitlab.syncad.com/hive/hive-uri) encoded transaction
   * @param uri hive:// prefixed URI
   * @param keyType Key type to be used to sign the transaction.
   * @returns Transaction result
   */
  async signAndBroadcastUri(uri: string, keyType: KeyTypes): Promise<OperationResult> {
    if (!this.isLoggedIn()) return notLoggedInResult
    else if (keyType === KeyTypes.Memo) return noMemoAllowResult
    let resolved: ResolveResult
    try {
      const decoded = decode(uri)
      resolved = resolveTransaction(decoded.tx, decoded.params, {
        ref_block_num: 1234,
        ref_block_prefix: 5678900,
        expiration: '2020-01-01T00:00:00', // dummy header values not used by signAndBroadcastTx
        signers: [this.getCurrentUser()!],
        preferred_signer: this.getCurrentUser()!
      })
    } catch (e) {
      return {
        success: false,
        errorCode: -32600,
        error: (e as any).toString()
      }
    }
    return await this.signAndBroadcastTx(resolved.tx.operations, keyType)
  }

  /**
   * Vote for a post or comment.
   * @param author Author
   * @param permlink Permlink
   * @param weight Vote weight in basis points. Must be between -10000 and 10000.
   * @returns Transaction result
   */
  async vote(author: string, permlink: string, weight: number): Promise<SignOperationResult> {
    if (!this.isLoggedIn()) return notLoggedInResult
    return await this.getPI().vote(author, permlink, weight)
  }

  /**
   * Vote multiple posts and/or comments.
   * @param votes Details of each vote including author, permlink and weight.
   * @returns Transaction result
   */
  async voteMany(votes: VoteParams[]): Promise<SignOperationResult> {
    if (!this.isLoggedIn()) return notLoggedInResult
    const voteOps: VoteOperation[] = []
    for (let i in votes) {
      voteOps.push(createVote(this.getCurrentUser()!, votes[i].author, votes[i].permlink, votes[i].weight))
    }
    return await this.signAndBroadcastTx(voteOps, KeyTypes.Posting)
  }

  /**
   * Create a post or comment.
   * @param pa Parent author
   * @param pp Parent permlink
   * @param permlink Permlink
   * @param title Title
   * @param body Body
   * @param json JSON metadata
   * @param options Comment options
   * @returns Transaction result
   */
  async comment(
    pa: string | null,
    pp: string | null,
    permlink: string,
    title: string,
    body: string,
    json: string | object,
    options?: CommentOptionsOperation[1]
  ): Promise<SignOperationResult> {
    if (!this.isLoggedIn()) return notLoggedInResult
    if (typeof json === 'object') json = JSON.stringify(json)
    return await this.getPI().comment(pa, pp, permlink, title, body, json, options)
  }

  /**
   * Delete a post or comment. The post or comment must contain no child comments or positive rshares.
   * @param permlink Permlink of the post or comment to delete.
   * @returns Transaction result
   */
  async deleteComment(permlink: string): Promise<SignOperationResult> {
    if (!this.isLoggedIn()) return notLoggedInResult
    return await this.getPI().deleteComment(permlink)
  }

  /**
   * Publish an arbitrary JSON data.
   * @param keyType Key type to use
   * @param id ID of the JSON.
   * @param json JSON payload
   * @param displayTitle Title to be displayed on certain providers that support them (i.e. Keychain).
   * @returns Transaction result
   */
  async customJSON(keyType: KeyTypes, id: string, json: string | object, displayTitle?: string): Promise<SignOperationResult> {
    if (!this.isLoggedIn()) return notLoggedInResult
    if (typeof json === 'object') json = JSON.stringify(json)
    else if (keyType === 'memo') return noMemoAllowResult
    return await this.getPI().customJSON(keyType, id, json, displayTitle)
  }

  /**
   * Add or remove someone elses post (or your own post that is posted to a Hivemind community) to your blog.
   * @param author Author of post
   * @param permlink Permlink of post
   * @param removeReblog Boolean of whether to remove the post from your blog instead.
   * @returns Transaction result
   */
  reblog(author: string, permlink: string, removeReblog: boolean): Promise<SignOperationResult> {
    return this.customJSON(
      KeyTypes.Posting,
      'reblog',
      [
        'reblog',
        {
          account: this.getCurrentUser()!,
          author,
          permlink,
          delete: removeReblog ? 'delete' : undefined
        }
      ],
      removeReblog ? 'Remove reblog' : 'Reblog'
    )
  }

  /**
   * Follow or unfollow a user.
   * @param target The username to follow
   * @param unfollow Boolean of whether to unfollow the account instead.
   * @returns Transaction result
   */
  follow(target: string, unfollow: boolean): Promise<SignOperationResult> {
    return this.customJSON(
      KeyTypes.Posting,
      'follow',
      [
        'follow',
        {
          follower: this.getCurrentUser()!,
          following: target,
          what: unfollow ? [] : ['blog']
        }
      ],
      unfollow ? 'Unfollow' : 'Follow'
    )
  }

  /**
   * Ignore a user from your feed.
   * @param target The username to ignore
   * @returns Transaction result
   */
  ignore(target: string): Promise<SignOperationResult> {
    return this.customJSON(
      KeyTypes.Posting,
      'follow',
      [
        'follow',
        {
          follower: this.getCurrentUser()!,
          following: target,
          what: ['ignore']
        }
      ],
      'Ignore'
    )
  }

  /**
   * Claim Hive rewards that have paid out from content reward pool.
   * @returns Transaction result
   */
  async claimRewards(): Promise<SignOperationResult> {
    if (!this.isLoggedIn()) return notLoggedInResult
    const accResp = await getAccounts([this.getCurrentUser()!], this.api)
    if (accResp.error || !Array.isArray(accResp.result) || accResp.result.length === 0)
      return error(-32603, 'Failed to fetch pending account rewards') // should we return error from hived instead?
    else if (
      accResp.result[0].reward_hive_balance === '0.000 HIVE' &&
      accResp.result[0].reward_hbd_balance === '0.000 HBD' &&
      accResp.result[0].reward_vesting_balance === '0.000000 VESTS'
    )
      return error(5200, 'There are no pending rewards to claim')
    return await this.signAndBroadcastTx(
      [
        [
          'claim_reward_balance',
          {
            account: this.getCurrentUser(),
            reward_hive: accResp.result[0].reward_hive_balance,
            reward_hbd: accResp.result[0].reward_hbd_balance,
            reward_vests: accResp.result[0].reward_vesting_balance
          }
        ]
      ],
      KeyTypes.Posting
    )
  }

  /**
   * Transfer HIVE/HBD to another account.
   * @param to Destination username
   * @param amount Transaction amount
   * @param currency HIVE or HBD
   * @param memo Memo to be attached in the transfer
   * @returns Transaction result
   */
  async transfer(to: string, amount: number, currency: Asset, memo?: string): Promise<SignOperationResult> {
    if (!this.isLoggedIn()) return notLoggedInResult
    return await this.getPI().transfer(to, amount, currency, memo)
  }

  /**
   * Recurrent transfer HIVE/HBD to another account.
   * @param to Destination username
   * @param amount Transaction amount
   * @param currency HIVE or HBD
   * @param recurrence Interval in hours between each transfer.
   * @param executions Number of transfers to be made automatically.
   * @param memo Memo to be attached in the transfer
   * @returns Transaction result
   */
  async recurrentTransfer(
    to: string,
    amount: number,
    currency: Asset,
    recurrence: number,
    executions: number,
    memo?: string,
    pair_id?: number
  ): Promise<SignOperationResult> {
    if (!this.isLoggedIn()) return notLoggedInResult
    if (recurrence < 24) return error(-32003, 'recurrence must be at least 24 hours') // should we let hived throw this error upon broadcast instead?
    return await this.getPI().recurrentTransfer(to, amount, currency, recurrence, executions, memo, pair_id)
  }

  /**
   * Cancel an ongoing recurrent transfer.
   * @param to Destination username
   * @param currency HIVE or HBD
   * @param memo Memo to be attached in the cancellation
   * @returns Transaction result
   */
  cancelRecurrentTransfer(to: string, currency: Asset, memo?: string): Promise<SignOperationResult> {
    return this.recurrentTransfer(to, 0, currency, 24, 2, memo)
  }

  /**
   * Stake HIVE.
   * @param amount HIVE to stake.
   * @param to Username to stake HIVE on behalf of. Usually and defaults to own account.
   * @returns Transaction result
   */
  async stakeHive(amount: number, to?: string): Promise<SignOperationResult> {
    if (!this.isLoggedIn()) return notLoggedInResult
    return await this.getPI().stakeHive(amount, to)
  }

  /**
   * Unstake HIVE.
   * @param amount HIVE to unstake.
   * @returns Transaction result
   */
  async unstakeHive(amount: number): Promise<SignOperationResult> {
    if (!this.isLoggedIn()) return notLoggedInResult
    return await this.getPI().unstakeHive(amount)
  }

  /**
   * Unstake HIVE by vesting shares.
   * @param vests
   * @returns Transaction result
   */
  async unstakeHiveByVests(vests: number): Promise<SignOperationResult> {
    if (!this.isLoggedIn()) return notLoggedInResult
    return await this.getPI().unstakeHiveByVests(vests)
  }

  /**
   * Delegate staked HIVE to another account.
   * @param to Delegatee
   * @param amount Staked HIVE to delegate
   * @returns Transaction result
   */
  async delegateStakedHive(to: string, amount: number): Promise<SignOperationResult> {
    if (!this.isLoggedIn()) return notLoggedInResult
    return await this.getPI().delegateStakedHive(to, amount)
  }

  /**
   * Delegate staked HIVE to another account by vesting shares.
   * @param to Delegatee
   * @param amount Vesting shares
   * @returns Transaction result
   */
  async delegateVests(to: string, amount: number): Promise<SignOperationResult> {
    if (!this.isLoggedIn()) return notLoggedInResult
    return await this.getPI().delegateVests(to, amount)
  }

  /**
   * Vote or unvote for a Hive witness.
   * @param witness Witness username to vote or unvote
   * @param approve Boolean for whether to vote or unvote the witness
   * @returns Transaction result
   */
  async voteWitness(witness: string, approve: boolean): Promise<SignOperationResult> {
    if (!this.isLoggedIn()) return notLoggedInResult
    return await this.getPI().voteWitness(witness, approve)
  }

  /**
   * Vote or unvote a list of DHF proposals by proposal IDs.
   * @param {number[]} proposals Array of proposal IDs to vote or unvote proposals
   * @param approve Boolean for whether to vote or unvote the proposals
   * @returns Transaction result
   */
  async voteProposals(proposals: number[], approve: boolean): Promise<SignOperationResult> {
    if (!this.isLoggedIn()) return notLoggedInResult
    return await this.getPI().voteProposals(proposals, approve)
  }

  /**
   * Set account proxy for governance voting.
   * @param proxy The proxy account username
   * @returns Transaction result
   */
  async setProxy(proxy: string): Promise<SignOperationResult> {
    if (!this.isLoggedIn()) return notLoggedInResult
    return await this.getPI().setProxy(proxy)
  }

  /**
   * Clear account proxy for governance voting.
   * @returns Transaction result
   */
  async clearProxy(): Promise<SignOperationResult> {
    return await this.setProxy('')
  }

  /**
   * Add an account auth.
   * @param username Account username to authorize
   * @param role KeyTypes role to authorize. Must be either KeyTypes.Posting or KeyTypes.Active
   * @param weight Weight of the account auth
   * @returns Transaction result
   */
  async addAccountAuthority(username: string, role: KeyTypes, weight: number): Promise<SignOperationResult> {
    if (!this.isLoggedIn()) return notLoggedInResult
    return await this.getPI().addAccountAuthority(username, role, weight)
  }

  /**
   * Remove an account auth.
   * @param username Account username to revoke
   * @param role KeyTypes role to revoke. Must be either KeyTypes.Posting or KeyTypes.Active
   * @returns Transaction result
   */
  async removeAccountAuthority(username: string, role: KeyTypes): Promise<SignOperationResult> {
    if (!this.isLoggedIn()) return notLoggedInResult
    return await this.getPI().removeAccountAuthority(username, role)
  }

  /**
   * Add a key auth.
   * @param username Public key to authorize
   * @param role KeyTypes role to authorize. Must be either KeyTypes.Posting or KeyTypes.Active
   * @param weight Weight of the key auth
   * @returns Transaction result
   */
  async addKeyAuthority(publicKey: string, role: KeyTypes, weight: number): Promise<SignOperationResult> {
    if (!this.isLoggedIn()) return notLoggedInResult
    return await this.getPI().addKeyAuthority(publicKey, role, weight)
  }

  /**
   * Remove a key auth.
   * @param username Public key to revoke
   * @param role KeyTypes role to revoke. Must be either KeyTypes.Posting or KeyTypes.Active
   * @param weight Weight of the key auth
   * @returns Transaction result
   */
  async removeKeyAuthority(publicKey: string, role: KeyTypes): Promise<SignOperationResult> {
    if (!this.isLoggedIn()) return notLoggedInResult
    return await this.getPI().removeKeyAuthority(publicKey, role)
  }

  /**
   * Set the Magi network ID for Magi related functions.
   * @param net_id Magi network ID to use.
   */
  vscSetNetId(net_id: string) {
    this.vscNetId = net_id
  }

  /**
   * Call a Magi contract from L1.
   * @param contractId Contract ID
   * @param action Contract action
   * @param payload Contract call payload
   * @param rc_limit Contract call RC limit
   * @param intents List of intents to be made available to the contract (i.e. token allowances)
   * @param keyType Key type to authenticate with. Valid values are `posting` and `active`.
   * @returns Transaction result
   */
  async vscCallContract(
    contractId: string,
    action: string,
    payload: any,
    rc_limit: number,
    intents: VscTxIntent[],
    keyType: KeyTypes = KeyTypes.Posting
  ): Promise<SignOperationResult> {
    if (keyType === 'memo') return noMemoAllowResult
    if (!this.isLoggedIn()) return notLoggedInResult
    return await this.getPI().vscCallContract(contractId, action, payload, rc_limit, intents, keyType, this.vscNetId)
  }

  /**
   * Transfer native assets on Magi.
   * @param to Destination address
   * @param amount Amount to transfer
   * @param currency HIVE or HBD
   * @param memo Transfer memo
   * @returns Transaction result
   */
  async vscTransfer(to: string, amount: number, currency: Asset, memo?: string): Promise<SignOperationResult> {
    if (!this.isLoggedIn()) return notLoggedInResult
    return await this.getPI().vscTransfer(to, amount, currency, memo, this.vscNetId)
  }

  /**
   * Withdraw native assets from Magi.
   * @param to Destination username
   * @param amount Amount to withdraw
   * @param currency HIVE or HBD
   * @param memo Withdraw memo
   * @returns Transaction result
   */
  async vscWithdraw(to: string, amount: number, currency: Asset, memo?: string): Promise<SignOperationResult> {
    if (!this.isLoggedIn()) return notLoggedInResult
    return await this.getPI().vscWithdraw(to, amount, currency, memo, this.vscNetId)
  }

  /**
   * Stake native assets on Magi.
   * @param stakeType VscStakeType enum of consensus stake or HBD savings
   * @param amount Amount to stake
   * @param to Destination address (default: logged in user)
   * @param memo Stake memo
   * @returns Transaction result
   */
  async vscStake(stakeType: VscStakeType, amount: number, to?: string, memo?: string): Promise<SignOperationResult> {
    if (!this.isLoggedIn()) return notLoggedInResult
    return await this.getPI().vscStake(stakeType, amount, to, memo, this.vscNetId)
  }

  /**
   * Unstake native assets on Magi.
   * @param stakeType VscStakeType enum of consensus stake or HBD savings
   * @param amount Amount to unstake
   * @param to Destination address (default: logged in user)
   * @param memo Unstake memo
   * @returns Transaction result
   */
  async vscUnstake(stakeType: VscStakeType, amount: number, to?: string, memo?: string): Promise<SignOperationResult> {
    if (!this.isLoggedIn()) return notLoggedInResult
    return await this.getPI().vscUnstake(stakeType, amount, to, memo, this.vscNetId)
  }

  // Event emitters
  on(eventName: Events, listener: Function) {
    this.eventEmitter.on(eventName, listener)
    return this
  }
  once(eventName: Events, listener: Function) {
    this.eventEmitter.once(eventName, listener)
    return this
  }
  off(eventName: Events, listener?: Function) {
    this.eventEmitter.off(eventName, listener)
    return this
  }
}

/**
 * Helper function that initizes an instance of Aioha class and setup the providers. Refer to the [docs](https://aioha.dev/docs/core/usage#instantiation) for details.
 * @param {SetupOptions} options Setup config for the providers
 * @returns {Aioha} an Aioha instance
 */
export const initAioha = (options?: SetupOptions): Aioha => {
  const aioha = new Aioha()
  aioha.setup(options)
  return aioha
}
