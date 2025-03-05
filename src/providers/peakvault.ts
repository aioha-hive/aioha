import { Operation, Transaction } from '@hiveio/dhive'
import { AiohaProviderBase } from './provider.js'
import { KeyTypes, LoginOptions, LoginResult, OperationResult, Providers, SignOperationResult } from '../types.js'
import { VaultBroadcastResponse, VaultError, VaultResponse } from '../lib/peakvault-types.js'

export class PeakVault extends AiohaProviderBase {
  private username?: string

  constructor() {
    super('')
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
    const memo = await this.decryptMemo(options.msg || window.crypto.randomUUID(), options.keyType || KeyTypes.Posting, username)
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

  isInstalled(): boolean {
    return !!window.peakvault
  }

  async decryptMemo(memo: string, keyType: KeyTypes, overrideUser?: string): Promise<OperationResult> {
    try {
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
