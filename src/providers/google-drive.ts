import type { LegacyOperation, LegacyTransaction } from '@aioha/types/dist/hive/legacy.js'
import type { HF26Operation, HF26Transaction } from '@aioha/types/dist/hive/hf26.js'
import { AiohaProviderBase, type KeySignerProvider } from './provider.js'
import { AiohaClient } from '../rpc.js'
import { SimpleEventEmitter } from '../lib/event-emitter.js'
import { error, loginError } from '../lib/errors.js'
import { GoogleDriveStorage, type GoogleTokenProvider } from '../lib/external-storage/google-drive-storage.js'
import { StorageFileNotFoundError, type WalletStorage } from '../lib/external-storage/storage.js'
import {
  createEmptyWallet,
  getRoleDefinitions,
  migrateWalletData,
  removeWalletKey,
  roleToKeyType,
  setWalletKey,
  type WalletData,
  type WalletRole
} from '../lib/external-storage/wallet-data.js'
import {
  AccountDiscStream,
  DiscoverOptions,
  KeyTypes,
  LoginOptions,
  LoginResult,
  LoginProvider,
  OperationResult,
  OperationResultObj,
  PersistentLogin,
  PersistentLoginBase,
  Providers,
  SignOperationResult,
  SignOperationResultObj,
  SignOperationResultObjHF26
} from '../types.js'

/** Default name to register the provider under with Aioha. */
export const GOOGLE_DRIVE_PROVIDER_NAME = 'googledrive'

/** Either a password used to derive the wallet encryption key, or the WIF encryption key itself. */
export type GoogleDrivePasswordCredentials = { password: string } | { encryptionKey: string }

/**
 * Queries for the wallet password or returns a cached encryption key.
 * @param missingWallet True when the wallet file does not exist yet, so a new password should be chosen.
 */
export type GoogleDrivePasswordProvider = (
  missingWallet: boolean
) => Promise<GoogleDrivePasswordCredentials> | GoogleDrivePasswordCredentials

export interface GoogleDriveProviderOptions {
  /**
   * Google OAuth2 access token provider, used to construct the default Google Drive storage.
   * Called before every Drive API request. The token must have the `drive.appdata` scope.
   * Use {@link createGoogleDriveTokenProvider} for Google Identity Services or
   * {@link createGoogleDriveBridgeTokenProvider} for the Hive Bridge backend.
   * Required when no {@link storage} provider is supplied.
   */
  tokenProvider?: GoogleTokenProvider
  /**
   * Custom wallet storage. Defaults to Google Drive's hidden app data folder.
   * Mostly useful for tests or for storing the wallet somewhere other than Google Drive.
   */
  storage?: WalletStorage
  /** Provides the wallet password or a cached wallet encryption key. */
  passwordProvider: GoogleDrivePasswordProvider
  /**
   * Key signer used for all signing, memo and transaction operations, and for deriving,
   * encrypting and decrypting the wallet file. Keys loaded from the wallet are injected
   * into it with `setKey()` before each operation. **Required.**
   *
   * Use an in-memory `PlaintextKeyProvider`, a `BeekeeperProvider`, or any other
   * provider implementing {@link KeySignerProvider}.
   */
  signer: KeySignerProvider
  /** Wallet file name in external storage. @default 'wallet.json' */
  storageFileName?: string
}

export interface PersistentLoginGoogleDrive extends PersistentLoginBase {
  provider: LoginProvider
}

/**
 * Google Drive signer provider.
 *
 * Hive private keys are stored encrypted in a wallet file in Google Drive's hidden
 * `appDataFolder` (or any custom {@link WalletStorage}). The wallet file format and
 * encryption are compatible with `@hiveio/wax-signers-external`, so wallets created
 * by either library can be read by the other.
 *
 * Keys are loaded from the wallet on demand and injected into the required key signer
 * provider. An in-memory `PlaintextKeyProvider` can be used, or a `BeekeeperProvider`
 * for stronger key isolation.
 *
 * Use {@link createGoogleDriveTokenProvider} for a browser-side Google Identity
 * Services flow, or {@link createGoogleDriveBridgeTokenProvider} to delegate OAuth
 * to the Hive Bridge backend.
 *
 * Register it like any other custom provider:
 *
 * ```ts
 * import { Aioha, KeyTypes } from '@aioha/aioha'
 * import { GoogleDriveProvider } from '@aioha/aioha/build/providers/custom/google-drive.js'
 * import { PlaintextKeyProvider } from '@aioha/aioha/build/providers/custom/plaintext.js'
 *
 * const aioha = new Aioha()
 * const provider = new GoogleDriveProvider({
 *   tokenProvider: async () => getGoogleAccessToken(),
 *   passwordProvider: async (missing) => ({ password: prompt(missing ? 'New password' : 'Password')! }),
 *   signer: new PlaintextKeyProvider()
 * })
 * aioha.registerCustomProvider('googledrive', provider)
 * await aioha.login('googledrive', 'alice', { msg: 'Login' })
 * ```
 */
export class GoogleDriveProvider extends AiohaProviderBase {
  private readonly signer: KeySignerProvider
  private readonly storage: WalletStorage
  private readonly passwordProvider: GoogleDrivePasswordProvider
  private readonly fileName: string

  private publicKey?: string
  private wallet?: WalletData
  private encryptionKeyWif?: string
  private unlockPromise?: Promise<WalletData>
  private injectedKeys = new Map<KeyTypes, string>()

  constructor(options: GoogleDriveProviderOptions, rpc: AiohaClient = new AiohaClient(), emitter?: SimpleEventEmitter) {
    super(rpc, emitter)
    if (!options?.passwordProvider) throw new Error('passwordProvider is required')
    if (!options.signer) throw new Error('signer is required')
    if (options.storage) this.storage = options.storage
    else if (options.tokenProvider) this.storage = new GoogleDriveStorage(options.tokenProvider)
    else throw new Error('either storage or tokenProvider is required')
    this.passwordProvider = options.passwordProvider
    this.fileName = options.storageFileName ?? 'wallet.json'

    this.signer = options.signer
    this.signer.setEventEmitter(this.eventEmitter)
    this.signer.setChainId(this.rpc.chainId)
  }

  setEventEmitter(emitter: SimpleEventEmitter) {
    super.setEventEmitter(emitter)
    this.signer.setEventEmitter(emitter)
  }

  setApi(api: string, fallbackApis?: string[]): void {
    this.signer.setApi(api, fallbackApis)
  }

  setChainId(chainId: string): void {
    this.signer.setChainId(chainId)
  }

  private async fetchWallet(): Promise<WalletData> {
    let raw: string | undefined
    try {
      raw = await this.storage.get(this.fileName)
    } catch (e) {
      if (!(e instanceof StorageFileNotFoundError)) throw e
    }
    const credentials = await this.passwordProvider(typeof raw === 'undefined')
    const encryptionKeyWif =
      'password' in credentials ? await this.signer.deriveWalletEncryptionKey(credentials.password) : credentials.encryptionKey
    // Throws for malformed WIFs before attempting decryption
    await this.signer.getPublicKey(encryptionKeyWif)
    let wallet = createEmptyWallet()
    if (typeof raw !== 'undefined') {
      try {
        wallet = migrateWalletData(JSON.parse(await this.signer.decryptWalletData(raw, encryptionKeyWif)))
      } catch {
        throw new Error('failed to decrypt wallet data, invalid password or corrupted data')
      }
    }
    this.encryptionKeyWif = encryptionKeyWif
    this.wallet = wallet
    return wallet
  }

  /** Fetches and decrypts the wallet, reusing the in-memory copy when already unlocked. */
  private async unlock(): Promise<WalletData> {
    if (this.wallet) return this.wallet
    if (!this.unlockPromise) this.unlockPromise = this.fetchWallet()
    try {
      return await this.unlockPromise
    } finally {
      this.unlockPromise = undefined
    }
  }

  private async saveWallet(wallet: WalletData): Promise<void> {
    if (!this.encryptionKeyWif) throw new Error('wallet is locked')
    const encrypted = await this.signer.encryptWalletData(JSON.stringify(wallet), this.encryptionKeyWif)
    await this.storage.save(this.fileName, encrypted)
  }

  private async getPrivateKeyWif(keyType: KeyTypes, username: string | undefined = this.getUser()): Promise<string> {
    if (!username) throw new Error('not logged in')
    const wallet = await this.unlock()
    const entry = getRoleDefinitions(wallet, username)[keyType as WalletRole]
    if (!entry) throw new Error(`no ${keyType} key found for account ${username} in Google Drive wallet`)
    return entry.privateKey
  }

  /** Loads the key for an account role and injects it into the signer when it changed. */
  private async ensureKey(keyType: KeyTypes, username: string | undefined = this.getUser()): Promise<string> {
    const wif = await this.getPrivateKeyWif(keyType, username)
    if (this.injectedKeys.get(keyType) !== wif) {
      await this.signer.setKey(keyType, wif)
      this.injectedKeys.set(keyType, wif)
    }
    return wif
  }

  async login(username: string, options: LoginOptions): Promise<LoginResult> {
    const keyType = options?.keyType ?? KeyTypes.Posting
    try {
      const wif = await this.ensureKey(keyType, username)
      const result = await this.signer.login(username, options)
      if (!result.success) return { ...result, provider: Providers.GoogleDrive }
      this.publicKey = result.publicKey ?? (await this.signer.getPublicKey(wif))
      return {
        ...result,
        provider: Providers.GoogleDrive,
        username: result.username ?? username,
        publicKey: this.publicKey
      }
    } catch (e) {
      return loginError(5000, e instanceof Error ? e.message : 'failed to login', Providers.GoogleDrive)
    }
  }

  async loginAndDecryptMemo(username: string, options: LoginOptions): Promise<LoginResult> {
    const keyType = options?.keyType ?? KeyTypes.Posting
    try {
      const wif = await this.ensureKey(keyType, username)
      const result = await this.signer.loginAndDecryptMemo(username, options)
      if (!result.success) return { ...result, provider: Providers.GoogleDrive }
      this.publicKey = result.publicKey ?? (await this.signer.getPublicKey(wif))
      return {
        ...result,
        provider: Providers.GoogleDrive,
        username: result.username ?? username,
        publicKey: this.publicKey
      }
    } catch (e) {
      return loginError(5000, e instanceof Error ? e.message : 'failed to login', Providers.GoogleDrive)
    }
  }

  async logout() {
    try {
      await this.signer.logout()
    } finally {
      delete this.publicKey
      this.lock()
    }
  }

  loadAuth(username: string): boolean {
    this.injectedKeys.clear()
    this.signer.clearKeys?.()
    delete this.publicKey
    return this.signer.loadAuth(username)
  }

  getUser(): string | undefined {
    return this.signer.getUser()
  }

  getLoginInfo(): PersistentLoginGoogleDrive | undefined {
    if (!this.getUser()) return undefined
    return { provider: Providers.GoogleDrive, pubKey: this.publicKey }
  }

  loadLogin(username: string, info: PersistentLogin): boolean {
    this.injectedKeys.clear()
    this.signer.clearKeys?.()
    delete this.publicKey
    const loaded = this.signer.loadAuth(username)
    if (loaded) this.publicKey = info.pubKey
    return loaded
  }

  async encryptMemo(message: string, keyType: KeyTypes, recipient: string): Promise<OperationResult> {
    try {
      await this.ensureKey(keyType)
      return await this.signer.encryptMemo(message, keyType, recipient)
    } catch {
      return error(5000, 'failed to encrypt memo')
    }
  }

  async encryptMemoWithKeys(message: string, keyType: KeyTypes, recipientKeys: string[]): Promise<OperationResultObj> {
    try {
      await this.ensureKey(keyType)
      return await this.signer.encryptMemoWithKeys(message, keyType, recipientKeys)
    } catch {
      return error(5000, 'failed to encrypt memo')
    }
  }

  async decryptMemo(memo: string, keyType: KeyTypes): Promise<OperationResult> {
    try {
      await this.ensureKey(keyType)
      return await this.signer.decryptMemo(memo, keyType)
    } catch {
      return error(5000, 'failed to decrypt memo')
    }
  }

  async signMessage(message: string, keyType: KeyTypes): Promise<OperationResult> {
    try {
      await this.ensureKey(keyType)
      return await this.signer.signMessage(message, keyType)
    } catch {
      return error(5000, 'failed to sign message')
    }
  }

  async signTx(tx: LegacyTransaction, keyType: KeyTypes): Promise<SignOperationResultObj> {
    try {
      await this.ensureKey(keyType)
      return await this.signer.signTx(tx, keyType)
    } catch {
      return error(5000, 'failed to sign transaction')
    }
  }

  async signAndBroadcastTx(tx: LegacyOperation[], keyType: KeyTypes): Promise<SignOperationResult> {
    try {
      await this.ensureKey(keyType)
      return await this.signer.signAndBroadcastTx(tx, keyType)
    } catch {
      return error(5000, 'failed to sign and/or broadcast transaction')
    }
  }

  async signTxHF26(tx: HF26Transaction, keyType: KeyTypes): Promise<SignOperationResultObjHF26> {
    try {
      await this.ensureKey(keyType)
      return await this.signer.signTxHF26(tx, keyType)
    } catch {
      return error(5000, 'failed to sign transaction')
    }
  }

  async signAndBroadcastTxHF26(tx: HF26Operation[], keyType: KeyTypes): Promise<SignOperationResult> {
    try {
      await this.ensureKey(keyType)
      return await this.signer.signAndBroadcastTxHF26(tx, keyType)
    } catch {
      return error(5000, 'failed to sign and/or broadcast transaction')
    }
  }

  async discoverAccounts(stream?: AccountDiscStream, options?: DiscoverOptions): Promise<OperationResultObj> {
    try {
      const wallet = await this.unlock()
      const result: { [username: string]: Array<{ pubkey: string; role: string }> } = {}
      for (const [account, accountData] of Object.entries(wallet.hive.accounts)) {
        const roles: Array<{ pubkey: string; role: string }> = []
        for (const [role, entry] of Object.entries(accountData.roleDefinitions)) {
          if (!entry) continue
          if (options?.roles && options.roles.length > 0 && !options.roles.includes(role as KeyTypes)) continue
          roles.push({ pubkey: await this.signer.getPublicKey(entry.privateKey), role })
        }
        if (roles.length > 0) result[account] = roles
      }
      if (stream) {
        let stopped = false
        for (const [username, roles] of Object.entries(result)) {
          for (let index = 0; index < roles.length && !stopped; index++)
            stream({ username, index, pubkey: roles[index].pubkey, role: roles[index].role }, () => {
              stopped = true
            })
          if (stopped) break
        }
      }
      return { success: true, result }
    } catch (e) {
      return error(5000, e instanceof Error ? e.message : 'failed to discover accounts')
    }
  }

  /**
   * Stores a private key for an account and role in the wallet file.
   * @param keyType Key role
   * @param account Hive account name
   * @param wif Private key WIF
   * @returns The public key of the stored key
   */
  async storeKey(keyType: KeyTypes, account: string, wif: string): Promise<OperationResult> {
    try {
      if (!account) throw new Error('account is required')
      const wallet = await this.unlock()
      const publicKey = await this.signer.getPublicKey(wif)
      setWalletKey(wallet, account, keyType as WalletRole, { privateKey: wif, publicKey })
      await this.saveWallet(wallet)
      if (this.getUser() === account) this.injectedKeys.delete(keyType)
      return { success: true, result: publicKey }
    } catch (e) {
      return error(5000, e instanceof Error ? e.message : 'failed to store key')
    }
  }

  /**
   * Removes a stored private key from the wallet file.
   * @param keyType Key role
   * @param account Hive account name
   */
  async removeKey(keyType: KeyTypes, account: string): Promise<OperationResult> {
    try {
      const wallet = await this.unlock()
      if (!removeWalletKey(wallet, account, keyType as WalletRole))
        return error(5000, `no ${keyType} key found for account ${account} in Google Drive wallet`)
      await this.saveWallet(wallet)
      if (this.getUser() === account) this.injectedKeys.delete(keyType)
      return { success: true, result: '' }
    } catch (e) {
      return error(5000, e instanceof Error ? e.message : 'failed to remove key')
    }
  }

  /** Returns all Hive accounts stored in the wallet file. */
  async getStoredAccounts(): Promise<string[]> {
    return Object.keys((await this.unlock()).hive.accounts)
  }

  /** Returns the key roles stored for an account. */
  async getStoredRoles(account: string): Promise<KeyTypes[]> {
    const roles = Object.keys(getRoleDefinitions(await this.unlock(), account))
    return roles.map((role) => roleToKeyType(role)).filter((role): role is KeyTypes => typeof role !== 'undefined')
  }

  /** Whether the wallet is currently decrypted and cached in memory. */
  isUnlocked(): boolean {
    return typeof this.wallet !== 'undefined'
  }

  /**
   * Returns the wallet encryption key WIF, or undefined when locked.
   * Applications may cache this key and return it from the password provider to
   * unlock the wallet without prompting for the password again.
   */
  getEncryptionKeyWif(): string | undefined {
    return this.encryptionKeyWif
  }

  /** Forgets the decrypted wallet, encryption key and injected signer keys. */
  lock(): void {
    delete this.wallet
    delete this.encryptionKeyWif
    delete this.unlockPromise
    this.injectedKeys.clear()
    this.signer.clearKeys?.()
  }
}

export type { GoogleTokenProvider, KeySignerProvider, WalletStorage }
export { createGoogleDriveTokenProvider, GOOGLE_DRIVE_APPDATA_SCOPE } from '../lib/external-storage/google-oauth.js'
