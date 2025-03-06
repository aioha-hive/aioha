import { Operation, Transaction } from '@hiveio/dhive'
import { AiohaProviderBase } from './provider.js'
import {
  KeyTypes,
  LoginOptions,
  LoginResult,
  OperationResult,
  OperationResultObj,
  PersistentLoginBase,
  Providers,
  SignOperationResult
} from '../types.js'
import { VaultBroadcastResponse, VaultError, VaultResponse } from '../lib/peakvault-types.js'
import { SimpleEventEmitter } from '../lib/event-emitter.js'

export class PeakVault extends AiohaProviderBase {
  private username?: string

  constructor(emitter: SimpleEventEmitter) {
    super('', emitter)
  }

  async login(username: string, options: LoginOptions): Promise<LoginResult> {
    if (!options || !options.keyType)
      return {
        provider: Providers.PeakVault,
        success: false,
        errorCode: 5003,
        error: 'keyType options are required'
      }
    else if (!this.isInstalled())
      return {
        provider: Providers.PeakVault,
        success: false,
        errorCode: 5001,
        error: 'Peak Vault extension is not installed'
      }
    try {
      this.eventEmitter!.emit('login_request')
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
      const error = e as VaultError
      return {
        provider: Providers.PeakVault,
        success: false,
        errorCode: 5000,
        error: error.message
      }
    }
  }

  async loginAndDecryptMemo(username: string, options: LoginOptions): Promise<LoginResult> {
    this.eventEmitter!.emit('login_request')
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
        : {
            success: false,
            errorCode: memo.errorCode,
            error: memo.error
          })
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
      return {
        success: false,
        errorCode: 5005,
        error: 'keyType must be memo for peakvault memo encryption'
      }
    }
    try {
      this.eventEmitter!.emit('memo_request')
      const encoded: VaultResponse = await window.peakvault.requestEncode(this.getUser()!, recipient, message)
      return {
        success: true,
        result: encoded.result!,
        publicKey: encoded.publicKey
      }
    } catch (e) {
      const error = e as VaultError
      return {
        success: false,
        errorCode: 5000,
        error: error.message
      }
    }
  }

  async encryptMemoWithKeys(message: string, keyType: KeyTypes, recipientKeys: string[]): Promise<OperationResultObj> {
    try {
      this.eventEmitter!.emit('memo_request')
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
      const error = e as VaultError
      return {
        success: false,
        errorCode: 5000,
        error: error.message
      }
    }
  }

  async decryptMemo(memo: string, keyType: KeyTypes, overrideUser?: string, emit: boolean = true): Promise<OperationResult> {
    try {
      if (emit) this.eventEmitter!.emit('memo_request')
      const decoded: VaultResponse = await window.peakvault.requestDecode(this.getUser() || overrideUser, memo, keyType)
      return {
        success: true,
        result: decoded.result!,
        publicKey: decoded.publicKey
      }
    } catch (e) {
      const error = e as VaultError
      return {
        success: false,
        errorCode: 5000,
        error: error.message
      }
    }
  }

  async signMessage(message: string, keyType: KeyTypes): Promise<OperationResult> {
    try {
      this.eventEmitter!.emit('sign_msg_request')
      const res: VaultResponse = await window.peakvault.requestSignBuffer(this.getUser()!, keyType, message)
      return {
        success: true,
        result: res.result!,
        publicKey: res.publicKey
      }
    } catch (e) {
      const error = e as VaultError
      return {
        success: false,
        errorCode: 5000,
        error: error.message
      }
    }
  }

  async signTx(tx: Transaction, keyType: KeyTypes): Promise<SignOperationResult> {
    try {
      this.eventEmitter!.emit('sign_tx_request')
      const res: VaultResponse = await window.peakvault.requestSignTx(this.getUser()!, tx, keyType)
      return {
        success: true,
        result: res.result
      }
    } catch (e) {
      const error = e as VaultError
      return {
        success: false,
        errorCode: 5000,
        error: error.message
      }
    }
  }

  async signAndBroadcastTx(tx: Operation[], keyType: KeyTypes): Promise<SignOperationResult> {
    try {
      this.eventEmitter!.emit('sign_tx_request')
      const res: VaultBroadcastResponse = await window.peakvault.requestBroadcast(this.getUser()!, tx, keyType)
      return {
        success: true,
        result: res.result!.tx_id
      }
    } catch (e) {
      const error = e as VaultError
      return {
        success: false,
        errorCode: 5000,
        error: error.message
      }
    }
  }
}
