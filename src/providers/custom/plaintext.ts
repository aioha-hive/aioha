import type { LegacyOperation, LegacySignedTransaction, LegacyTransaction } from '@aioha/types/dist/hive/legacy.js'
import type { HF26Operation, HF26SignedTransaction, HF26Transaction } from '@aioha/types/dist/hive/hf26.js'
import { sha256 } from '@noble/hashes/sha2.js'
import { AiohaProviderBase, type WalletKeyProvider } from '../provider.js'
import { constructTxHeader } from '../../opbuilder.js'
import { AiohaClient, broadcastTxHF26 } from '../../rpc.js'
import { oldToHF26Operation, oldToHF26Tx } from '../../lib/hf26-adapter.js'
import { error, UNK_BC_ERROR, UNK_SBC_ERROR } from '../../lib/errors.js'
import {
  decryptMemo as decryptMemoData,
  decryptWalletData as decryptWalletDataWithKey,
  deriveWalletEncryptionKey as deriveWalletEncryptionKeyFromPassword,
  encryptMemo as encryptMemoData,
  encryptWalletData as encryptWalletDataWithKey,
  getPublicKeyFromWif,
  messageDigest,
  signDigest
} from '../../lib/crypto.js'
import {
  AccountAuths,
  KeyTypes,
  LoginOptions,
  LoginResult,
  OperationResult,
  OperationResultObj,
  PersistentLogin,
  PersistentLoginBase,
  Providers,
  SignOperationResult,
  SignOperationResultObj,
  SignOperationResultObjHF26
} from '../../types.js'

/**
 * Plaintext private key provider using noble crypto.
 *
 * The private key is held in memory, so this is best suited for backends or for
 * local signing where the key was already decrypted from encrypted storage (e.g.
 * when used as the key signer of the Google Drive provider). Prefer
 * `BeekeeperProvider` when stronger key isolation is required.
 *
 * Can be constructed with a WIF directly, or without one and used as a runtime
 * key signer via `setKey()`.
 */
export class PlaintextKeyProvider extends AiohaProviderBase implements WalletKeyProvider {
  private user?: string
  private defaultWif?: string
  private keys: Partial<Record<KeyTypes, string>> = {}

  constructor(wif?: string, rpc: AiohaClient = new AiohaClient()) {
    super(rpc)
    if (typeof wif !== 'undefined') {
      getPublicKeyFromWif(wif)
      this.defaultWif = wif
    }
  }

  /**
   * Sets the private key used for signing and returns its public key.
   */
  setKey(keyType: KeyTypes, wif: string): string {
    const publicKey = getPublicKeyFromWif(wif)
    this.keys[keyType] = wif
    return publicKey
  }

  /** Derives the public key for a WIF private key. */
  getPublicKey(wif: string): string {
    return getPublicKeyFromWif(wif)
  }

  /** Derives the wallet encryption key WIF from a password. */
  deriveWalletEncryptionKey(password: string): string {
    return deriveWalletEncryptionKeyFromPassword(password)
  }

  /** Encrypts wallet data with a wallet encryption key WIF. */
  encryptWalletData(content: string, encryptionKeyWif: string): Promise<string> {
    return encryptWalletDataWithKey(content, encryptionKeyWif)
  }

  /** Decrypts wallet data with a wallet encryption key WIF. */
  decryptWalletData(encrypted: string, encryptionKeyWif: string): Promise<string> {
    return decryptWalletDataWithKey(encrypted, encryptionKeyWif)
  }

  /** Forgets all keys held by this provider. */
  clearKeys(): void {
    this.keys = {}
    delete this.defaultWif
  }

  private getWif(keyType?: KeyTypes): string {
    // Runtime keys are role-specific. A constructor/legacy WIF is only used as a
    // default when no runtime keys have been injected.
    if (Object.keys(this.keys).length > 0) {
      const key = keyType ? this.keys[keyType] : undefined
      if (typeof key !== 'undefined') return key
      throw new Error(`no ${keyType ?? 'private'} key available`)
    }
    if (typeof this.defaultWif !== 'undefined') return this.defaultWif
    throw new Error('no private key available')
  }

  private getPersistentWif(): string | undefined {
    return (
      this.defaultWif ??
      this.keys[KeyTypes.Posting] ??
      this.keys[KeyTypes.Active] ??
      this.keys[KeyTypes.Owner] ??
      this.keys[KeyTypes.Memo]
    )
  }

  async login(username: string, options: LoginOptions): Promise<LoginResult> {
    this.emitLoginReq()
    const signed = await this.signMessage(options?.msg ?? 'Login', options.keyType ?? KeyTypes.Posting)
    if (signed.success) {
      this.user = username
      return { ...signed, provider: Providers.Custom, username }
    }
    return { ...signed, provider: Providers.Custom }
  }

  async loginAndDecryptMemo(username: string, options: LoginOptions): Promise<LoginResult> {
    this.emitLoginReq()
    const r = await this.decryptMemo(options?.msg ?? '', options?.keyType ?? KeyTypes.Posting)
    if (r.success) {
      this.user = username
      return { ...r, username, provider: Providers.Custom }
    }
    return { ...r, provider: Providers.Custom }
  }

  async logout() {
    delete this.user
  }

  loadAuth(username: string): boolean {
    this.user = username
    return true
  }

  getUser(): string | undefined {
    return this.user
  }

  getLoginInfo(): PersistentLoginPlaintext | undefined {
    const wif = this.getPersistentWif()
    if (this.getUser() && typeof wif !== 'undefined') return { provider: Providers.Custom, wif, keys: { ...this.keys } }
  }

  loadLogin(username: string, info: PersistentLogin): boolean {
    const persistent = info as PersistentLoginPlaintext
    this.keys = { ...persistent.keys }
    if (typeof persistent.wif === 'string') {
      getPublicKeyFromWif(persistent.wif)
      this.defaultWif = persistent.wif
    } else delete this.defaultWif
    return this.loadAuth(username)
  }

  setChainId(chainId: string): void {
    this.rpc.chainId = chainId
  }

  async encryptMemo(message: string, keyType: KeyTypes, recipient: string): Promise<OperationResult> {
    this.emitMemoReq()
    try {
      const wif = this.getWif(keyType)
      const keys = await this.rpc.callRest<AccountAuths>(`/hafbe-api/accounts/${recipient}/authority`)
      let recipientKey: string | undefined
      if (keyType === KeyTypes.Memo) recipientKey = keys.memo
      else recipientKey = keys[keyType].key_auths[0][0]
      if (!recipientKey) throw new Error(`no ${keyType} key found for account ${recipient}`)
      return { success: true, result: await encryptMemoData(this.stripMemoPrefix(message), wif, recipientKey) }
    } catch {
      return error(5000, 'failed to encrypt memo')
    }
  }

  async encryptMemoWithKeys(message: string, keyType: KeyTypes, recipientKeys: string[]): Promise<OperationResultObj> {
    this.emitMemoReq()
    try {
      const wif = this.getWif(keyType)
      const results: { [pub: string]: string } = {}
      const plaintext = this.stripMemoPrefix(message)
      for (const recipientKey of recipientKeys) results[recipientKey] = await encryptMemoData(plaintext, wif, recipientKey)
      return { success: true, result: results }
    } catch {
      return error(5000, 'failed to encrypt memo')
    }
  }

  async decryptMemo(memo: string, keyType: KeyTypes): Promise<OperationResult> {
    this.emitMemoReq()
    try {
      return { success: true, result: await decryptMemoData(memo, this.getWif(keyType)) }
    } catch {
      return error(5000, 'failed to decrypt memo')
    }
  }

  async signMessage(message: string, keyType: KeyTypes): Promise<OperationResult> {
    this.emitSignMsg()
    try {
      const wif = this.getWif(keyType)
      return {
        success: true,
        result: signDigest(messageDigest(message), wif),
        publicKey: getPublicKeyFromWif(wif)
      }
    } catch {
      return error(5000, 'failed to sign message')
    }
  }

  async signTx(tx: LegacyTransaction, keyType: KeyTypes): Promise<SignOperationResultObj> {
    const signed = await this.signTxHF26(oldToHF26Tx(tx), keyType)
    if (!signed.success) return signed
    const result: LegacySignedTransaction = { ...structuredClone(tx), signatures: signed.result.signatures }
    return { success: true, result }
  }

  async signAndBroadcastTx(tx: LegacyOperation[], keyType: KeyTypes): Promise<SignOperationResult> {
    return await this.signAndBroadcastTxHF26(
      tx.map((op) => oldToHF26Operation(op)),
      keyType
    )
  }

  async signTxHF26(tx: HF26Transaction, keyType: KeyTypes): Promise<SignOperationResultObjHF26> {
    this.emitSignTx()
    try {
      const wif = this.getWif(keyType)
      const { transactionDigest } = await import(/* webpackChunkName: 'tx-digest' */ '@aioha/tx-digest')
      const { digest } = await transactionDigest(tx, this.rpc.chainId, sha256)
      const result: HF26SignedTransaction = { ...tx, signatures: [signDigest(digest, wif)] }
      return { success: true, result }
    } catch {
      return error(5000, 'failed to sign transaction')
    }
  }

  async signAndBroadcastTxHF26(tx: HF26Operation[], keyType: KeyTypes): Promise<SignOperationResult> {
    try {
      const unsignedTx = (await constructTxHeader(tx, this.rpc.api)) as HF26Transaction
      const signedTx = await this.signTxHF26(unsignedTx, keyType)
      if (!signedTx.success) return signedTx
      const { transactionDigest } = await import(/* webpackChunkName: 'tx-digest' */ '@aioha/tx-digest')
      const txId = (await transactionDigest(unsignedTx, this.rpc.chainId, sha256)).txId
      const broadcasted = await broadcastTxHF26(signedTx.result, this.rpc.api, [...this.rpc.fallbackApis])
      if (broadcasted.error)
        return error(broadcasted.error.code ?? -32603, broadcasted.error.message ?? UNK_BC_ERROR)
      return { success: true, result: txId }
    } catch {
      return error(5000, UNK_SBC_ERROR)
    }
  }

  private stripMemoPrefix(memo: string): string {
    return memo.startsWith('#') ? memo.slice(1) : memo
  }
}

export interface PersistentLoginPlaintext extends PersistentLoginBase {
  provider: Providers.Custom
  wif: string
  /** Runtime keys per key type, when the provider was used as a key signer. */
  keys?: Partial<Record<KeyTypes, string>>
}
