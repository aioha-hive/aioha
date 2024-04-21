import { KeychainSDK } from 'keychain-sdk'
import { AiohaProvider } from './provider.js'
import { KeychainOptions, LoginOptions, LoginResult } from '../types.js'

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
    const login = await this.provider.login({
      username: username,
      message: options.msg,
      method: options.keychain.keyType,
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
    const login = await this.provider.decode({
      username: username,
      message: options.msg,
      method: options.keychain.keyType
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

  static isInstalled(): Promise<boolean> {
    return new KeychainSDK(window).isKeychainInstalled()
  }
}
