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
    if (!options || !options.keychainAuthType || !options.hiveauthAuthType)
      return {
        provider: 'hiveauth',
        success: false,
        error: 'auth type must be present'
      }
    try {
      const login = await HaWrapper.authenticate(this.provider, username, {
        key_type: options.hiveauthAuthType,
        challenge: options.msg ?? ''
      })
      return {
        provider: 'hiveauth',
        success: true,
        message: '',
        result: (login as any).data.challenge.challenge,
        publicKey: (login as any).data.challenge.pubkey
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
}
