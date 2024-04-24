import hivesigner, { Client } from 'hivesigner'
import { ClientConfig } from 'hivesigner/lib/types/client-config.interface.js'
import { AiohaProvider } from './provider.js'
import { KeyTypes, LoginOptions, LoginResult, OperationResult } from '../types.js'

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
          if (token && loggedInUser) {
            this.provider.setAccessToken(token)
            rs({
              provider: 'hivesigner',
              success: true,
              message: 'HiveSigner authentication success',
              result: token,
              username: loggedInUser
            })
          } else
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
    const result = await this.decryptMemo(username, options.msg, 'posting')
    if (result.success)
      return {
        provider: 'hivesigner',
        success: true,
        message: 'Memo decoded successfully',
        username: login.username,
        result: result.result
      }
    return {
      provider: 'hivesigner',
      error: result.error!,
      success: false
    }
  }

  async logout(): Promise<void> {
    try {
      await this.provider.revokeToken()
      localStorage.removeItem('hivesignerToken')
      localStorage.removeItem('hivesignerExpiry')
      localStorage.removeItem('hivesignerUsername')
      this.provider.removeAccessToken()
    } catch {}
  }

  getLoginURL(options: LoginOptions, username?: string) {
    return this.provider.getLoginURL((options && options.hivesigner && options.hivesigner.state) ?? '', username)
  }

  loadAuth(): boolean {
    const token = localStorage.getItem('hivesignerToken')
    const exp = localStorage.getItem('hivesignerExpiry')
    const loggedInUser = localStorage.getItem('hivesignerUsername')
    if (!token || !exp || !loggedInUser) return false
    const expSeconds = parseInt(exp)
    if (isNaN(expSeconds) || new Date().getTime() / 1000 >= expSeconds) return false
    this.provider.setAccessToken(token)
    return true
  }

  async decryptMemo(username: string, memo: string, keyType: KeyTypes): Promise<OperationResult> {
    if (keyType !== 'posting')
      return {
        success: false,
        error: 'Memo must be decrypted using @hivesigner account posting key'
      }
    const decoded = await this.provider.decode(memo)
    if (decoded.memoDecoded)
      return {
        success: true,
        result: decoded.memoDecoded
      }
    else
      return {
        success: false,
        error: 'Failed to decrypt memo'
      }
  }

  async signMessage(): Promise<OperationResult> {
    return {
      success: false,
      error: 'message signing is unsupported with HiveSigner provider'
    }
  }
}
