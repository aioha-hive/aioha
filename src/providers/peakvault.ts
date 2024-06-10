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
        error: 'keyType options are required'
      }
    else if (!this.isInstalled())
      return {
        provider: Providers.PeakVault,
        success: false,
        error: 'Peak Vault extension is not installed'
      }
    try {
      const res: VaultResponse = await window.peakvault.requestSignBuffer(username, options.keyType, options.msg)
      return {
        provider: Providers.PeakVault,
        success: res.success,
        result: res.result,
        message: res.success ? 'Message signed successfully' : 'Failed to sign message',
        username: username,
        publicKey: res.publicKey
      }
    } catch (e) {
      const error = e as VaultError
      return {
        provider: Providers.PeakVault,
        success: false,
        error: error.message,
        message: 'Failed to sign message',
        username: username
      }
    }
  }

  async loginAndDecryptMemo(username: string, options: LoginOptions): Promise<LoginResult> {
    return this.decryptMemo(options.msg || window.crypto.randomUUID(), options.keyType || KeyTypes.Posting, username)
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
      const decoded: VaultResponse = await window.peakvault.requestDecode(this.getUser()!, memo, keyType)
      return {
        success: decoded.success,
        result: decoded.result,
        publicKey: decoded.publicKey
      }
    } catch (e) {
      const error = e as VaultError
      return {
        success: false,
        error: error.message,
        message: 'Failed to decrypt memo'
      }
    }
  }

  async signMessage(message: string, keyType: KeyTypes): Promise<OperationResult> {
    try {
      const res: VaultResponse = await window.peakvault.requestSignBuffer(this.getUser()!, keyType, message)
      return {
        success: res.success,
        result: res.result,
        message: res.success ? 'Message signed successfully' : 'Failed to sign message',
        publicKey: res.publicKey
      }
    } catch (e) {
      const error = e as VaultError
      return {
        success: false,
        error: error.message,
        message: 'Failed to sign message'
      }
    }
  }

  async signTx(tx: Transaction, keyType: KeyTypes): Promise<SignOperationResult> {
    if (keyType === KeyTypes.Memo)
      return {
        success: false,
        error: 'keyType must not be memo'
      }
    try {
      const res: VaultResponse = await window.peakvault.requestSignTx(this.getUser()!, tx, keyType)
      return {
        success: res.success,
        result: res.result,
        message: res.success ? 'Transaction signed successfully' : 'Failed to sign transaction'
      }
    } catch (e) {
      const error = e as VaultError
      return {
        success: false,
        error: error.message,
        message: 'Failed to sign transaction'
      }
    }
  }

  async signAndBroadcastTx(tx: Operation[], keyType: KeyTypes): Promise<SignOperationResult> {
    if (keyType === KeyTypes.Memo)
      return {
        success: false,
        error: 'keyType must not be memo'
      }
    try {
      const res: VaultBroadcastResponse = await window.peakvault.requestBroadcast(this.getUser()!, tx, keyType)
      return {
        success: res.success,
        result: res.result!.tx_id,
        message: res.success ? 'Transaction signed and broadcasted successfully' : 'Failed to sign and broadcast transaction'
      }
    } catch (e) {
      const error = e as VaultError
      return {
        success: false,
        error: error.message,
        message: 'Failed to sign and broadcast transaction'
      }
    }
  }
}
