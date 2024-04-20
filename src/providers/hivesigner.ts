import hivesigner, { Client } from 'hivesigner'
import { ClientConfig } from 'hivesigner/lib/types/client-config.interface.js'
import { AiohaProvider } from './provider.js'
import { LoginOptions, LoginResult } from '../types.js'

export class HiveSigner extends AiohaProvider {
  protected provider: Client
  constructor(options: ClientConfig) {
    super()
    this.provider = new hivesigner.Client(options)
  }

  async login(username: string, options: LoginOptions): Promise<LoginResult> {
    if (!options || !options.hivesigner)
      return {
        success: false,
        error: 'hivesigner options are required'
      }
    const login = this.provider.login({
      state: options.hivesigner.state ?? ''
    })
    // TODO: oauth2 callback
    return {
      provider: 'hivesigner',
      success: true
    }
  }

  async loginAndDecryptMemo(username: string, options: LoginOptions): Promise<LoginResult> {
    if (!options || typeof options.msg !== 'string' || !options.msg.startsWith('#'))
      return {
        provider: 'hivesigner',
        error: 'memo to decode must be a vaid string beginning with #',
        success: false
      }
    await this.login(username, options)
    try {
      const result = await this.provider.decode(options.msg)
      return {
        provider: 'hivesigner',
        success: true,
        message: 'Memo decoded successfully',
        username: username,
        result: result.memoDecoded
      }
    } catch {
      return {
        provider: 'hivesigner',
        error: 'failed to decode memo',
        success: false
      }
    }
  }

  getLoginURL(options: LoginOptions) {
    if (!options || !options.hivesigner) throw new Error('Hivesigner options are required')
    return this.provider.getLoginURL(options.hivesigner.state ?? '')
  }
}
