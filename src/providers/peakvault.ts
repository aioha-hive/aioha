import { Operation, SignedTransaction, Transaction } from '@hiveio/dhive'
import { AiohaProviderBase } from './provider.js'
import {
  KeyTypes,
  LoginOptions,
  LoginResult,
  OperationResult,
  OperationResultObj,
  PersistentLoginBase,
  Providers,
  SignOperationResult,
  SignOperationResultObj
} from '../types.js'
import { VaultBroadcastResponse, VaultError, VaultResponse } from '../lib/peakvault-types.js'
import { SimpleEventEmitter } from '../lib/event-emitter.js'
import { error, loginError } from '../lib/errors.js'

export class PeakVault extends AiohaProviderBase {
  private username?: string

  constructor(emitter: SimpleEventEmitter) {
    super('', emitter)
  }

  async login(username: string, options: LoginOptions): Promise<LoginResult> {
    if (!this.isInstalled()) return loginError(5001, 'Peak Vault extension is not installed', Providers.PeakVault)
    try {
      this.emitLoginReq()
      const res: VaultResponse = await window.peakvault.requestSignBuffer(username, options.keyType, options.msg)
      this.username = username
      return {
        provider: Providers.PeakVault,
        success: true,
        result: res.result!,
        username: username,
        publicKey: res.publicKey
      }
    } catch (e) {
      return loginError(5000, (e as VaultError).message, Providers.PeakVault)
    }
  }

  async loginAndDecryptMemo(username: string, options: LoginOptions): Promise<LoginResult> {
    this.emitLoginReq()
    const memo = await this.decryptMemo(
      options.msg || window.crypto.randomUUID(),
      options.keyType || KeyTypes.Posting,
      username,
      false
    )
    if (memo.success) this.username = username
    return {
      provider: Providers.PeakVault,
      ...(memo.success
        ? {
            success: true,
            result: memo.result,
            username
          }
        : error(memo.errorCode, memo.error))
    }
  }

  async logout(): Promise<void> {
    delete this.username
  }

  loadAuth(username: string): boolean {
    this.username = username
    return true
  }

  getUser(): string | undefined {
    return this.username
  }

  getLoginInfo(): PersistentLoginBase | undefined {
    if (this.getUser()) return { provider: Providers.PeakVault }
  }

  loadLogin(username: string): boolean {
    return this.loadAuth(username)
  }

  isInstalled(): boolean {
    return !!window.peakvault
  }

  async encryptMemo(message: string, keyType: KeyTypes, recipient: string): Promise<OperationResult> {
    if (keyType !== KeyTypes.Memo) {
      return error(5005, 'keyType must be memo for peakvault memo encryption')
    }
    try {
      this.emitMemoReq()
      const encoded: VaultResponse = await window.peakvault.requestEncode(this.getUser()!, recipient, message)
      return {
        success: true,
        result: encoded.result!,
        publicKey: encoded.publicKey
      }
    } catch (e) {
      return error(5000, (e as VaultError).message)
    }
  }

  async encryptMemoWithKeys(message: string, keyType: KeyTypes, recipientKeys: string[]): Promise<OperationResultObj> {
    try {
      this.emitMemoReq()
      const encoded: VaultResponse = await window.peakvault.requestEncodeWithKeys(
        this.getUser()!,
        keyType,
        recipientKeys,
        message
      )
      const results: { [pub: string]: string } = {}
      for (let k in recipientKeys) results[recipientKeys[k]] = encoded.result![k]
      return {
        success: true,
        result: results,
        publicKey: encoded.publicKey
      }
    } catch (e) {
      return error(5000, (e as VaultError).message)
    }
  }

  async decryptMemo(memo: string, keyType: KeyTypes, overrideUser?: string, emit: boolean = true): Promise<OperationResult> {
    try {
      if (emit) this.emitMemoReq()
      const decoded: VaultResponse = await window.peakvault.requestDecode(this.getUser() || overrideUser, memo, keyType)
      return {
        success: true,
        result: decoded.result!,
        publicKey: decoded.publicKey
      }
    } catch (e) {
      return error(5000, (e as VaultError).message)
    }
  }

  async signMessage(message: string, keyType: KeyTypes): Promise<OperationResult> {
    try {
      this.eventEmitter.emit('sign_msg_request')
      const res: VaultResponse = await window.peakvault.requestSignBuffer(this.getUser()!, keyType, message)
      return {
        success: true,
        result: res.result!,
        publicKey: res.publicKey
      }
    } catch (e) {
      return error(5000, (e as VaultError).message)
    }
  }

  async signTx(tx: Transaction, keyType: KeyTypes): Promise<SignOperationResultObj> {
    try {
      this.emitSignTx()
      const res: VaultResponse<SignedTransaction> = await window.peakvault.requestSignTx(this.getUser()!, tx, keyType)
      return {
        success: true,
        result: res.result!
      }
    } catch (e) {
      return error(5000, (e as VaultError).message)
    }
  }

  async signAndBroadcastTx(tx: Operation[], keyType: KeyTypes): Promise<SignOperationResult> {
    try {
      this.emitSignTx()
      const res: VaultBroadcastResponse = await window.peakvault.requestBroadcast(this.getUser()!, tx, keyType)
      return {
        success: true,
        result: res.result!.tx_id
      }
    } catch (e) {
      return error(5000, (e as VaultError).message)
    }
  }
}
