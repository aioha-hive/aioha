import HaWrapper, { Auth, AppMetaType } from '../lib/hiveauth-wrapper.js'
import { AiohaProvider } from './provider.js'
import { LoginOptions, LoginResult } from '../types.js'

const HiveAuthError = (e: any) => {
  if (e.toString() === 'Error: expired') return 'HiveAuth authentication request expired'
  else if (e.cmd === 'auth_nack') return 'HiveAuth authentication request rejected'
  else if (e.cmd === 'sign_nack') return 'HiveAuth broadcast request rejected'
  else if (e.cmd === 'auth_err' || e.cmd === 'sign_err') return e.error
}

export class HiveAuth extends AiohaProvider {
  protected provider: Auth

  constructor(options: AppMetaType) {
    super()
    this.provider = new Auth(options)
  }

  async login(username: string, options: LoginOptions): Promise<LoginResult> {
    if (!options || !options.hiveauth)
      return {
        provider: 'hiveauth',
        success: false,
        error: 'hiveauth options must be present'
      }
    try {
      const login = await HaWrapper.authenticate(
        this.provider,
        username,
        {
          key_type: options.hiveauth.authType,
          challenge: options.msg ?? ''
        },
        options.hiveauth.cbWait
      )
      return {
        provider: 'hiveauth',
        success: true,
        message: 'Login Success',
        result: login.challenge.challenge,
        publicKey: login.challenge.pubkey
      }
    } catch (e) {
      return {
        provider: 'hiveauth',
        success: false,
        error: HiveAuthError(e)
      }
    }
  }

  async loginAndDecryptMemo(username: string, options: LoginOptions): Promise<LoginResult> {
    throw new Error('TODO')
  }

  async logout(): Promise<void> {
    this.provider.logout()
  }
}
