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
    const login = await this.provider.login({
      username: username,
      message: options.msg,
      method: options.keychainAuthType!,
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
    const login = await this.provider.decode({
      username: username,
      message: options.msg,
      method: options.keychainAuthType!
    })
    return {
      provider: 'keychain',
      success: login.success,
      message: login.message,
      result: login.result as unknown as string
    }
  }

  static async isInstalled(): Promise<boolean> {
    return await new KeychainSDK(window).isKeychainInstalled()
  }
}
