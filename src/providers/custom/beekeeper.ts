import type { Operation, SignedTransaction, Transaction } from '@hiveio/dhive'
import { AiohaProviderBase } from '../provider.js'
import { constructTxHeader } from '../../opbuilder.js'
import { type AiohaClient, broadcastTxHF26, callRest } from '../../rpc.js'
import { oldToHF26Operation, oldToHF26Tx } from '../../lib/hf26-adapter.js'
import type { HF26Operation, HF26SignedTransaction, HF26Transaction } from '../../lib/hf26-types.js'
import { SimpleEventEmitter } from '../../lib/event-emitter.js'
import { sha256Bytes } from '../../lib/sha256-browser.js'
import { error } from '../../lib/errors.js'
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

export type Sha256Function = (message: Uint8Array<ArrayBuffer>) => Promise<Uint8Array> | Uint8Array

export interface BeekeeperWallet {
  signDigest(publicKey: string, sigDigest: string): string
  encryptData(content: string, key: string, anotherKey?: string, nonce?: number): string
  decryptData(content: string, key: string, anotherKey?: string): string
}

export interface PersistentLoginBeekeeper extends PersistentLoginBase {
  provider: Providers.Custom
  keys: Partial<Record<KeyTypes, string>>
}

const toHex = (bytes: Uint8Array): string =>
  Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')

export class BeekeeperProvider extends AiohaProviderBase {
  private wallet: BeekeeperWallet
  private keys: Partial<Record<KeyTypes, string>>
  private user?: string
  private sha256Fn: Sha256Function

  constructor(
    wallet: BeekeeperWallet,
    keys: Partial<Record<KeyTypes, string>>,
    rpc: AiohaClient,
    emitter: SimpleEventEmitter,
    sha256Fn?: Sha256Function
  ) {
    super(rpc, emitter)
    this.wallet = wallet
    this.keys = keys
    this.sha256Fn = sha256Fn ?? sha256Bytes
  }

  private getKey(keyType: KeyTypes): string {
    const key = this.keys[keyType]
    if (!key) throw new Error(`no ${keyType} key available`)
    return key
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
    const r = await this.decryptMemo(options!.msg!, options!.keyType ?? KeyTypes.Posting)
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

  getLoginInfo(): PersistentLoginBeekeeper | undefined {
    if (this.getUser())
      return {
        provider: Providers.Custom,
        keys: { ...this.keys }
      }
  }

  loadLogin(username: string, info: PersistentLogin): boolean {
    this.keys = { ...(info as PersistentLoginBeekeeper).keys }
    return this.loadAuth(username)
  }

  async encryptMemo(message: string, keyType: KeyTypes, recipient: string): Promise<OperationResult> {
    this.emitMemoReq()
    try {
      const keys = await callRest<AccountAuths>(`/hafbe-api/accounts/${recipient}/authority`)
      if (!keys[keyType]) throw ''
      const recipientKey = keyType === KeyTypes.Memo ? keys.memo : keys[keyType].key_auths[0][0]
      const ownKey = this.getKey(keyType)
      const encoded = this.wallet.encryptData(message, ownKey, recipientKey)
      return { success: true, result: encoded }
    } catch {
      return { success: false, errorCode: 5000, error: 'failed to encrypt memo' }
    }
  }

  async encryptMemoWithKeys(message: string, keyType: KeyTypes, recipientKeys: string[]): Promise<OperationResultObj> {
    this.emitMemoReq()
    try {
      const ownKey = this.getKey(keyType)
      const results: { [pub: string]: string } = {}
      for (const k of recipientKeys) results[k] = this.wallet.encryptData(message, ownKey, k)
      return { success: true, result: results }
    } catch {
      return { success: false, errorCode: 5000, error: 'failed to encrypt memo' }
    }
  }

  async decryptMemo(memo: string, keyType: KeyTypes): Promise<OperationResult> {
    this.emitMemoReq()
    try {
      const key = this.getKey(keyType)
      const decoded = this.wallet.decryptData(memo, key)
      return { success: true, result: decoded }
    } catch {
      return { success: false, errorCode: 5000, error: 'failed to decrypt memo' }
    }
  }

  async signMessage(message: string, keyType: KeyTypes): Promise<OperationResult> {
    this.eventEmitter.emit('sign_msg_request')
    try {
      const key = this.getKey(keyType)
      const digest = await this.sha256Fn(new TextEncoder().encode(message))
      const sig = this.wallet.signDigest(key, toHex(digest))
      return { success: true, result: sig, publicKey: key }
    } catch {
      return { success: false, errorCode: 5000, error: 'failed to sign message' }
    }
  }

  async signTx(tx: Transaction, keyType: KeyTypes): Promise<SignOperationResultObj> {
    const signed = await this.signTxHF26(oldToHF26Tx(tx), keyType)
    if (!signed.success) return signed
    const result = structuredClone(tx) as SignedTransaction
    result.signatures = signed.result.signatures
    return { success: true, result }
  }

  async signAndBroadcastTx(tx: Operation[], keyType: KeyTypes): Promise<SignOperationResult> {
    return await this.signAndBroadcastTxHF26(
      tx.map((t) => oldToHF26Operation(t)),
      keyType
    )
  }

  async signTxHF26(tx: HF26Transaction, keyType: KeyTypes): Promise<SignOperationResultObjHF26> {
    try {
      const key = this.getKey(keyType)
      this.emitSignTx()
      const { transactionDigest } = await import(/* webpackChunkName: 'tx-digest' */ '@aioha/tx-digest')
      const { digest } = await transactionDigest(tx, this.rpc.chainId, this.sha256Fn)
      const sig = this.wallet.signDigest(key, toHex(digest))
      const result: HF26SignedTransaction = { ...tx, signatures: [sig] }
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
      const txId = (await transactionDigest(unsignedTx, this.rpc.chainId, this.sha256Fn)).txId
      const broadcasted = await broadcastTxHF26(signedTx.result, this.rpc.api, [...this.rpc.fallbackApis])
      if (broadcasted.error)
        return error(
          broadcasted.error.code ?? -32603,
          broadcasted.error.message ?? 'Failed to broadcast transaction due to unknown error'
        )
      return { success: true, result: txId }
    } catch {
      return error(5000, 'failed to sign and/or broadcast transaction')
    }
  }
}
