import hivesigner, { Client } from 'hivesigner'
import { ClientConfig } from 'hivesigner/lib/types/client-config.interface.js'
import { AiohaProvider } from './provider.js'
import { LoginOptions, LoginResult } from '../types.js'

export class HiveSigner extends AiohaProvider {
  protected provider: Client
  constructor(options: ClientConfig) {
    super()
    if (!options.callbackURL?.startsWith(window.location.origin))
      throw new Error('callback URL must be in the same domain or subdomain as the current page')
    this.provider = new hivesigner.Client(options)
  }

  async login(username: string, options: LoginOptions): Promise<LoginResult> {
    return new Promise((rs) => {
      let loggedInUser: string | null, token: string | null
      const loginURL = this.getLoginURL(options, username ?? undefined)
      const hsWindow = window.open(loginURL)
      let hsInterval = setInterval(() => {
        if (hsWindow && hsWindow.closed) {
          clearInterval(hsInterval)
          token = localStorage.getItem('hivesignerToken')
          loggedInUser = localStorage.getItem('hivesignerUsername')
          if (token && loggedInUser)
            rs({
              provider: 'hivesigner',
              success: true,
              message: 'HiveSigner authentication success',
              result: token,
              username: loggedInUser
            })
          else
            rs({
              provider: 'hivesigner',
              success: false,
              error: 'Failed to obtain HiveSigner access token'
            })
        }
      }, 1000)
    })
  }

  async loginAndDecryptMemo(username: string, options: LoginOptions): Promise<LoginResult> {
    if (!options || typeof options.msg !== 'string' || !options.msg.startsWith('#'))
      return {
        provider: 'hivesigner',
        error: 'memo to decode must be a valid string beginning with #, encrypted with @hivesigner public posting key',
        success: false
      }
    const login = await this.login(username, options)
    if (!login.success) return login
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
        error: 'Failed to decode memo',
        success: false
      }
    }
  }

  getLoginURL(options: LoginOptions, username?: string) {
    return this.provider.getLoginURL((options && options.hivesigner && options.hivesigner.state) ?? '', username)
  }
}
