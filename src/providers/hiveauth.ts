import { Operation } from '@hiveio/dhive'
import HaWrapper, { Auth, AppMetaType, KeyType } from '../lib/hiveauth-wrapper.js'
import { AiohaProviderBase } from './provider.js'
import { KeyTypes, LoginOptions, LoginResult, OperationResult, Providers, SignOperationResult } from '../types.js'

const HiveAuthError = (e: any): string => {
  if (e.toString() === 'Error: expired') return 'HiveAuth authentication request expired'
  else if (e.toString() === 'Error: cancelled') return 'HiveAuth authentication request cancelled'
  else if (e.cmd === 'auth_nack') return 'HiveAuth authentication request rejected'
  else if (e.cmd === 'sign_nack') return 'HiveAuth broadcast request rejected'
  else if (e.cmd === 'auth_err' || e.cmd === 'sign_err') return e.error
  else return 'Unknown error'
}

export class HiveAuth extends AiohaProviderBase {
  private provider: Auth

  constructor(api: string, options: AppMetaType) {
    super(api)
    this.provider = new Auth(options)
  }

  async login(username: string, options: LoginOptions): Promise<LoginResult> {
    if (!options || !options.hiveauth || !options.keyType)
      return {
        provider: Providers.HiveAuth,
        success: false,
        error: 'hiveauth and keyType options must be present'
      }
    try {
      await HaWrapper.initCrypto()
      const login = await HaWrapper.authenticate(
        this.provider,
        username,
        {
          key_type: options.keyType,
          challenge: options.msg ?? ''
        },
        options.hiveauth.cbWait
      )
      if (this.provider.token) localStorage.setItem('hiveauthToken', this.provider.token)
      localStorage.setItem('hiveauthKey', this.provider.key!)
      localStorage.setItem('hiveauthExp', this.provider.expire!.toString())
      return {
        provider: Providers.HiveAuth,
        success: true,
        message: 'Login Success',
        result: login.challenge.challenge,
        publicKey: login.challenge.pubkey
      }
    } catch (e) {
      return {
        provider: Providers.HiveAuth,
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
    localStorage.removeItem('hiveauthToken')
    localStorage.removeItem('hiveauthKey')
    localStorage.removeItem('hiveauthExp')
  }

  loadAuth(username: string): boolean {
    const token = localStorage.getItem('hiveauthToken')
    const key = localStorage.getItem('hiveauthKey')
    const exp = localStorage.getItem('hiveauthExp')
    if (!key || !exp) return false
    const expMs = parseInt(exp)
    if (isNaN(expMs) || new Date().getTime() >= expMs) return false
    this.provider.username = username
    this.provider.key = key
    this.provider.expire = expMs
    if (token) this.provider.token = token
    return true
  }

  getUser(): string | undefined {
    return this.provider.username
  }

  async decryptMemo(): Promise<OperationResult> {
    return {
      success: false,
      error: 'Memo cryptography operations are currently unavailable in HiveAuth'
    }
  }

  async signMessage(message: string, keyType: KeyTypes): Promise<OperationResult> {
    try {
      await HaWrapper.initCrypto()
      const signed = await HaWrapper.challenge(this.provider, {
        key_type: keyType,
        challenge: message
      })
      return {
        success: true,
        message: 'Message signed successfully',
        result: signed.challenge,
        publicKey: signed.pubkey
      }
    } catch (e) {
      return {
        success: false,
        error: HiveAuthError(e)
      }
    }
  }

  async signTx(tx: any, keyType: KeyType): Promise<OperationResult> {
    // the HiveAuth sign tx without broadcast implementation at protocol level is not the same as keychain
    // as it only accepts array of tx operations as inputs without tx headers which is not very useful when
    // trying to sign a multisig transaction.
    return {
      success: false,
      error: 'Not implemented'
    }
  }

  async signAndBroadcastTx(tx: Operation[], keyType: KeyType): Promise<SignOperationResult> {
    try {
      await HaWrapper.initCrypto()
      const broadcasted = await HaWrapper.signTx(this.provider, keyType, tx, true, (msg) => {
        console.log('Please approve tx in HiveAuth PKSA, uuid: ' + msg.uuid)
      })
      return {
        success: true,
        message: 'The transaction has been broadcasted successfully.',
        result: broadcasted.data
      }
    } catch (e) {
      return {
        success: false,
        error: HiveAuthError(e)
      }
    }
  }
}
