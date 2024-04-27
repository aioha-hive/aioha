import { KeychainKeyTypes, KeychainRequestResponse, KeychainSDK } from 'keychain-sdk'
import { Operation, Transaction } from '@hiveio/dhive'
import { AiohaProvider } from './provider.js'
import { KeyTypes, KeychainOptions, LoginOptions, LoginResult, OperationResult, SignOperationResult } from '../types.js'

export class Keychain extends AiohaProvider {
  protected provider: KeychainSDK
  private loginTitle: string = 'Login'

  constructor(options?: KeychainOptions) {
    super()
    this.provider = new KeychainSDK(window)
    if (options && options.loginTitle) this.loginTitle = options.loginTitle
  }

  async login(username: string, options: LoginOptions): Promise<LoginResult> {
    if (!options || !options.keychain)
      return {
        provider: 'keychain',
        success: false,
        error: 'keyType options are required'
      }
    else if (!(await Keychain.isInstalled()))
      return {
        provider: 'keychain',
        success: false,
        error: 'Keychain extension is not installed'
      }
    const login = await this.provider.login({
      username: username,
      message: options.msg,
      method: Keychain.mapAiohaKeyTypes(options.keychain.keyType),
      title: this.loginTitle
    })
    return {
      provider: 'keychain',
      success: login.success,
      message: login.message,
      result: login.result,
      publicKey: login.publicKey
    }
  }

  async loginAndDecryptMemo(username: string, options: LoginOptions): Promise<LoginResult> {
    if (!options.msg || !options.msg.startsWith('#'))
      return {
        provider: 'keychain',
        success: false,
        error: 'message to decode must start with #'
      }
    else if (!options || !options.keychain)
      return {
        provider: 'keychain',
        success: false,
        error: 'keyType options are required'
      }
    else if (!(await Keychain.isInstalled()))
      return {
        provider: 'keychain',
        success: false,
        error: 'Keychain extension is not installed'
      }
    const login = await this.provider.decode({
      username: username,
      message: options.msg,
      method: Keychain.mapAiohaKeyTypes(options.keychain.keyType)
    })
    return {
      provider: 'keychain',
      success: login.success,
      message: login.message,
      result: login.result as unknown as string
    }
  }

  async logout(): Promise<void> {
    // keychain technically does not establish an ongoing connection to the app, so we do nothing here
  }

  loadAuth(): boolean {
    // no provider specific auth persistence details to load
    return true
  }

  static isInstalled(): Promise<boolean> {
    return new KeychainSDK(window).isKeychainInstalled()
  }

  static mapAiohaKeyTypes(keyType: KeyTypes): KeychainKeyTypes {
    switch (keyType) {
      case 'posting':
        return KeychainKeyTypes.posting
      case 'active':
        return KeychainKeyTypes.active
      case 'memo':
        return KeychainKeyTypes.memo
    }
  }

  async decryptMemo(username: string, memo: string, keyType: KeyTypes): Promise<OperationResult> {
    const kcKeyType = Keychain.mapAiohaKeyTypes(keyType)
    const decoded = await this.provider.decode({
      username,
      message: memo,
      method: kcKeyType
    })
    return {
      success: decoded.success,
      error: decoded.error ? decoded.message : undefined,
      result: decoded.result as unknown as string
    }
  }

  async signMessage(username: string, message: string, keyType: KeyTypes): Promise<OperationResult> {
    const kcKeyType = Keychain.mapAiohaKeyTypes(keyType)
    const signBuf = await this.provider.signBuffer({
      username,
      message,
      method: kcKeyType
    })
    if (!signBuf.success)
      return {
        success: false,
        error: signBuf.error
      }
    return {
      success: signBuf.success,
      message: signBuf.message,
      result: signBuf.result as unknown as string,
      publicKey: signBuf.publicKey
    }
  }

  async signTx(username: string, tx: Transaction, keyType: KeyTypes): Promise<SignOperationResult> {
    const kcKeyType = Keychain.mapAiohaKeyTypes(keyType)
    const signedTx = await this.provider.signTx({
      username,
      tx,
      method: kcKeyType
    })
    if (!signedTx.success)
      return {
        success: false,
        error: signedTx.error
      }
    return {
      success: signedTx.success,
      message: signedTx.message,
      result: signedTx.result
    }
  }

  async signAndBroadcastTx(username: string, tx: Operation[], keyType: KeyTypes): Promise<SignOperationResult> {
    const kcKeyType = Keychain.mapAiohaKeyTypes(keyType)
    try {
      const broadcastedTx = await this.provider.broadcast({
        username,
        operations: tx,
        method: kcKeyType
      })
      if (!broadcastedTx.success)
        return {
          success: false,
          error: broadcastedTx.message
        }
      return {
        success: broadcastedTx.success,
        message: broadcastedTx.message,
        result: broadcastedTx.result!.id
      }
    } catch (e) {
      return {
        success: false,
        error: (e as KeychainRequestResponse).message
      }
    }
  }
}
