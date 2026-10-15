import { sha256 } from '@noble/hashes/sha2.js'
import type { Operation, SignedTransaction, Transaction } from '@hiveio/dhive'
import { AiohaProviderBase } from '../provider.js'
import { type AiohaClient } from '../../rpc.js'
import type { HF26Operation, HF26SignedTransaction, HF26Transaction } from '../../lib/hf26-types.js'
import { SimpleEventEmitter } from '../../lib/event-emitter.js'
import { error, loginError } from '../../lib/errors.js'
import {
  AccountDiscStream,
  DiscoverOptions,
  KeyTypes,
  LoginOptions,
  LoginResult,
  OperationResult,
  OperationResultObj,
  PersistentLogin,
  Providers,
  SignOperationResult,
  SignOperationResultObj,
  SignOperationResultObjHF26
} from '../../types.js'
import { GoogleStorageProvider, TokenProvider } from './lib/google-drive-storage.js'
import { AStorageProviderBase, StorageFileNotFoundError } from './lib/storage-provider.js'
import { createEmptyWalletData, migrateWalletData, WalletRole, IWalletDataV3, IWalletKeyEntry } from './lib/wallet-data.js'

/**
 * Aioha signer provider capable of runtime key loading and key-based data
 * encryption/decryption, used by the external wallet provider for all signing,
 * memo and wallet file storage operations.
 */
export interface ExternalSigner extends AiohaProviderBase {
  /**
   * Injects a private key WIF for the given key type.
   * @returns The public key of the injected key
   */
  setKey(keyType: KeyTypes, wif: string): Promise<string> | string
  /**
   * Derives the public key for a private key WIF.
   */
  getPublicKey(wif: string): Promise<string> | string
  /**
   * Encrypts data with the given key, encrypted to itself.
   * Used for the wallet file stored in external storage.
   */
  encryptData(content: string, key: string): Promise<string> | string
  /**
   * Decrypts data encrypted with the given key.
   */
  decryptData(content: string, key: string): Promise<string> | string
}

/**
 * Storage encryption credentials - either a password to derive the encryption key from,
 * or the derived encryption key WIF itself.
 */
export type TStorageEncryptionCredentials = { password: string } | { encryptionKey: string }

/**
 * Callback function to query for the storage password or provide the cached encryption key.
 * @param missingStorageFile true if the wallet file does not exist yet in external storage,
 * which should enforce querying for a new password.
 * @returns Either a password (which will be used to derive the encryption key) or the encryption key WIF directly.
 */
export type TStoragePasswordProvider = (missingStorageFile: boolean) => Promise<TStorageEncryptionCredentials>

export interface ExternalWalletProviderOptions {
  /**
   * External storage provider for the wallet file. Any implementation of
   * {@link AStorageProviderBase} may be used. Only Google Drive is supported
   * out of the box - provide a `tokenProvider` to use the default Google Drive
   * storage provider instead.
   */
  storage?: AStorageProviderBase
  /**
   * Google OAuth2 token provider, used to construct the default Google Drive
   * storage provider. Invoked before each storage API call to ensure fresh tokens.
   * The token must have the 'https://www.googleapis.com/auth/drive.appdata' scope.
   * Required when no `storage` provider is provided.
   */
  tokenProvider?: TokenProvider
  /**
   * Storage password / encryption key provider for the wallet file stored in external storage.
   */
  passwordProvider: TStoragePasswordProvider
  /**
   * The Aioha signer provider used for all signing, memo and wallet file storage operations.
   * Must implement the {@link ExternalSigner} interface (e.g. BeekeeperProvider, PlaintextKeyProvider).
   * Keys loaded from external storage are injected into this provider via its `setKey()` method.
   */
  signer: ExternalSigner
  /**
   * Name of the wallet file stored in external storage.
   * @default 'wallet.json'
   */
  storageFileName?: string
  /**
   * Name this provider is registered under with Aioha, used by `getLoginInfo()` for user switching.
   */
  providerName?: string
}

/** Encodes a 32-byte private key scalar into a hive WIF string. */
const privateKeyToWif = (privateKey: Uint8Array): string => {
  const payload = new Uint8Array(33)
  payload[0] = 0x80
  payload.set(privateKey, 1)
  const checksum = sha256(sha256(payload)).slice(0, 4)
  const result = new Uint8Array(37)
  result.set(payload, 0)
  result.set(checksum, 33)
  const ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'
  let zeros = 0
  while (result[zeros] === 0) zeros++
  const input = Array.from(result)
  let str = ''
  while (input.length > 0) {
    let carry = 0
    for (let i = 0; i < input.length; i++) {
      const num = carry * 256 + input[i]
      carry = num % 58
      input[i] = Math.floor(num / 58)
    }
    str = ALPHABET[carry] + str
    while (input.length > 0 && input[0] === 0) input.shift()
  }
  return '1'.repeat(zeros) + str
}

/**
 * Derives the wallet encryption key from a password.
 * Matches wax's `getPrivateKeyFromPassword('dummyaccount', 'posting', password)`
 * used by @hiveio/wax-signers-external.
 */
export const deriveEncryptionKey = (password: string): string =>
  privateKeyToWif(sha256(new TextEncoder().encode('dummyaccountposting' + password)))

/**
 * External signer provider backed by encrypted external storage (Google Drive).
 *
 * Private keys are stored encrypted in a wallet file in external storage (Google Drive
 * by default), encrypted with a format compatible with @hiveio/wax-signers-external
 * via the signer provider. The provider does not sign anything itself - all signing,
 * transaction, memo and wallet file encryption operations are delegated to an
 * application-specified Aioha signer (e.g. BeekeeperProvider or PlaintextKeyProvider)
 * after loading the required key from external storage.
 */
export class ExternalWalletProvider extends AiohaProviderBase {
  private readonly signer: ExternalSigner
  private readonly storage: AStorageProviderBase
  private readonly passwordProvider: TStoragePasswordProvider
  private readonly fileName: string
  private providerName?: string

  private walletData?: IWalletDataV3
  private encKey?: string
  private injectedKeys = new Map<KeyTypes, string>()

  constructor(options: ExternalWalletProviderOptions, rpc: AiohaClient, emitter: SimpleEventEmitter) {
    super(rpc, emitter)
    this.signer = options.signer
    if (options.storage) {
      this.storage = options.storage
    } else if (options.tokenProvider) {
      this.storage = new GoogleStorageProvider(options.tokenProvider)
    } else {
      throw new Error('either storage or tokenProvider is required')
    }
    this.passwordProvider = options.passwordProvider
    this.fileName = options.storageFileName ?? 'wallet.json'
    this.providerName = options.providerName
  }

  setProviderName(name: string) {
    this.providerName = name
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

  /**
   * Fetches and decrypts the wallet file from external storage, or creates an empty wallet
   * if it does not exist yet. The decrypted wallet data and encryption key are cached in memory.
   */
  private async unlock(): Promise<void> {
    if (this.walletData) return
    let raw: string | undefined
    try {
      raw = await this.storage.get(this.fileName)
    } catch (e) {
      if (!(e instanceof StorageFileNotFoundError)) throw e
    }
    const missing = typeof raw === 'undefined'
    const credentials = await this.passwordProvider(missing)
    const encKey = 'password' in credentials ? deriveEncryptionKey(credentials.password) : credentials.encryptionKey
    this.encKey = encKey
    if (missing) {
      this.walletData = createEmptyWalletData()
    } else {
      const decrypted = await this.signer.decryptData(raw!, encKey)
      this.walletData = migrateWalletData(JSON.parse(decrypted))
    }
  }

  /** Encrypts and saves the wallet data to external storage. */
  private async saveStorage(data: IWalletDataV3): Promise<void> {
    await this.storage.save(this.fileName, await this.signer.encryptData(JSON.stringify(data), this.encKey!))
  }

  private async loadKeyEntry(keyType: KeyTypes, username: string): Promise<IWalletKeyEntry> {
    const accountData = this.walletData!.hive.accounts[username]
    const entry = accountData?.roleDefinitions[keyType as WalletRole]
    if (!entry) throw new Error(`no ${keyType} key found for account ${username} in external storage`)
    return entry
  }

  /** Loads a key from external storage and injects it into the signer provider if needed. */
  private async ensureSignerKey(keyType: KeyTypes, entry: IWalletKeyEntry): Promise<void> {
    const pub = await this.signer.getPublicKey(entry.privateKey)
    if (this.injectedKeys.get(keyType) === pub) return
    await this.signer.setKey(keyType, entry.privateKey)
    this.injectedKeys.set(keyType, pub)
  }

  /** Ensures the current user's key for the given key type is loaded into the signer. */
  private async ensureKey(keyType: KeyTypes): Promise<OperationResult> {
    try {
      const username = this.getUser()
      if (!username) return error(4900, 'Not logged in')
      await this.unlock()
      await this.ensureSignerKey(keyType, await this.loadKeyEntry(keyType, username))
      return { success: true, result: '' }
    } catch (e) {
      return error(5000, e instanceof Error ? e.message : 'failed to load key from external storage')
    }
  }

  async login(username: string, options: LoginOptions): Promise<LoginResult> {
    try {
      await this.unlock()
      await this.ensureSignerKey(
        options?.keyType ?? KeyTypes.Posting,
        await this.loadKeyEntry(options?.keyType ?? KeyTypes.Posting, username)
      )
    } catch (e) {
      return loginError(5000, e instanceof Error ? e.message : 'failed to login', this.providerName)
    }
    return await this.signer.login(username, options)
  }

  async loginAndDecryptMemo(username: string, options: LoginOptions): Promise<LoginResult> {
    try {
      await this.unlock()
      await this.ensureSignerKey(
        options?.keyType ?? KeyTypes.Posting,
        await this.loadKeyEntry(options?.keyType ?? KeyTypes.Posting, username)
      )
    } catch (e) {
      return loginError(5000, e instanceof Error ? e.message : 'failed to login', this.providerName)
    }
    return await this.signer.loginAndDecryptMemo(username, options)
  }

  async logout() {
    this.injectedKeys.clear()
    delete this.walletData
    delete this.encKey
    await this.signer.logout()
  }

  loadAuth(username: string): boolean {
    this.injectedKeys.clear()
    return this.signer.loadAuth(username)
  }

  getUser(): string | undefined {
    return this.signer.getUser()
  }

  getLoginInfo(): PersistentLogin | undefined {
    const info = this.signer.getLoginInfo()
    if (!info) return undefined
    return { ...info, provider: this.providerName ?? Providers.Custom }
  }

  loadLogin(username: string, info: PersistentLogin): boolean {
    this.injectedKeys.clear()
    return this.signer.loadLogin(username, info)
  }

  async encryptMemo(message: string, keyType: KeyTypes, recipient: string): Promise<OperationResult> {
    const check = await this.ensureKey(keyType)
    if (!check.success) return check
    return await this.signer.encryptMemo(message, keyType, recipient)
  }

  async encryptMemoWithKeys(message: string, keyType: KeyTypes, recipientKeys: string[]): Promise<OperationResultObj> {
    const check = await this.ensureKey(keyType)
    if (!check.success) return check
    return await this.signer.encryptMemoWithKeys(message, keyType, recipientKeys)
  }

  async decryptMemo(memo: string, keyType: KeyTypes): Promise<OperationResult> {
    const check = await this.ensureKey(keyType)
    if (!check.success) return check
    return await this.signer.decryptMemo(memo, keyType)
  }

  async signMessage(message: string, keyType: KeyTypes): Promise<OperationResult> {
    const check = await this.ensureKey(keyType)
    if (!check.success) return check
    return await this.signer.signMessage(message, keyType)
  }

  async signTx(tx: Transaction, keyType: KeyTypes): Promise<SignOperationResultObj> {
    const check = await this.ensureKey(keyType)
    if (!check.success) return check
    return await this.signer.signTx(tx, keyType)
  }

  async signAndBroadcastTx(tx: Operation[], keyType: KeyTypes): Promise<SignOperationResult> {
    const check = await this.ensureKey(keyType)
    if (!check.success) return check
    return await this.signer.signAndBroadcastTx(tx, keyType)
  }

  async signTxHF26(tx: HF26Transaction, keyType: KeyTypes): Promise<SignOperationResultObjHF26> {
    const check = await this.ensureKey(keyType)
    if (!check.success) return check
    return await this.signer.signTxHF26(tx, keyType)
  }

  async signAndBroadcastTxHF26(tx: HF26Operation[], keyType: KeyTypes): Promise<SignOperationResult> {
    const check = await this.ensureKey(keyType)
    if (!check.success) return check
    return await this.signer.signAndBroadcastTxHF26(tx, keyType)
  }

  async discoverAccounts(stream?: AccountDiscStream, options?: DiscoverOptions): Promise<OperationResultObj> {
    try {
      await this.unlock()
      const result: { [username: string]: Array<{ pubkey: string; role: string }> } = {}
      for (const [account, accountData] of Object.entries(this.walletData!.hive.accounts)) {
        const roles: Array<{ pubkey: string; role: string }> = []
        for (const [role, entry] of Object.entries(accountData.roleDefinitions)) {
          if (options?.roles && options.roles.length > 0 && !options.roles.includes(role as KeyTypes)) continue
          roles.push({ pubkey: await this.signer.getPublicKey(entry!.privateKey), role })
        }
        if (roles.length > 0) result[account] = roles
      }
      if (stream) {
        let stopped = false
        for (const [account, roles] of Object.entries(result)) {
          if (stopped) break
          for (const role of roles) {
            if (stopped) break
            stream({ username: account, pubkey: role.pubkey, role: role.role }, () => {
              stopped = true
            })
          }
        }
      }
      return { success: true, result }
    } catch (e) {
      return error(5000, e instanceof Error ? e.message : 'failed to discover accounts from external storage')
    }
  }

  /**
   * Stores a private key for the given account and role in the wallet file in external storage.
   * @param keyType Role of the key to store (posting, active, owner or memo)
   * @param account Hive account username
   * @param wif Private key WIF to store
   */
  async storeKey(keyType: KeyTypes, account: string, wif: string): Promise<OperationResult> {
    try {
      await this.unlock()
      const data = this.walletData!
      if (!data.hive.accounts[account]) data.hive.accounts[account] = { roleDefinitions: {} }
      data.hive.accounts[account].roleDefinitions[keyType as WalletRole] = { privateKey: wif }
      await this.saveStorage(data)
      return { success: true, result: await this.signer.getPublicKey(wif) }
    } catch (e) {
      return error(5000, e instanceof Error ? e.message : 'failed to store key')
    }
  }

  /**
   * Removes a stored key for the given account and role from the wallet file in external storage.
   * @param keyType Role of the key to remove
   * @param account Hive account username
   */
  async removeKey(keyType: KeyTypes, account: string): Promise<OperationResult> {
    try {
      await this.unlock()
      const accountData = this.walletData!.hive.accounts[account]
      if (!accountData?.roleDefinitions[keyType as WalletRole])
        return error(5000, `no ${keyType} key found for account ${account} in external storage`)
      delete accountData.roleDefinitions[keyType as WalletRole]
      if (Object.keys(accountData.roleDefinitions).length === 0) delete this.walletData!.hive.accounts[account]
      await this.saveStorage(this.walletData!)
      this.injectedKeys.delete(keyType)
      return { success: true, result: '' }
    } catch (e) {
      return error(5000, e instanceof Error ? e.message : 'failed to remove key')
    }
  }

  /** Returns the usernames of all Hive accounts stored in the wallet file. */
  async getStoredAccounts(): Promise<string[]> {
    await this.unlock()
    return Object.keys(this.walletData!.hive.accounts)
  }

  /** Returns the roles stored in the wallet file for the given account. */
  async getStoredRoles(account: string): Promise<WalletRole[]> {
    await this.unlock()
    return Object.keys(this.walletData!.hive.accounts[account]?.roleDefinitions ?? {}) as WalletRole[]
  }

  /**
   * Returns the encryption key WIF used for the wallet file.
   * Allows the application to cache it (e.g. in localStorage) and return it from the
   * password provider to unlock the wallet without re-prompting for the password.
   */
  getEncryptionKeyWif(): string | undefined {
    return this.encKey
  }
}
