import { Operation } from '@hiveio/dhive'
import HaWrapper, { Auth, AppMetaType } from '../lib/hiveauth-wrapper.js'
import { AiohaProviderBase } from './provider.js'
import {
  KeyTypes,
  LoginOptions,
  LoginResult,
  OperationError,
  OperationResult,
  PersistentLogin,
  PersistentLoginHiveAuth,
  Providers,
  SignOperationResult,
  SignOperationResultObj
} from '../types.js'
import { SimpleEventEmitter } from '../lib/event-emitter.js'

const HiveAuthError = (e: any): string => {
  if (e.name === 'HiveAuthInternalError') return e.message
  if (e.toString() === 'Error: expired') return 'HiveAuth authentication request expired'
  else if (e.toString() === 'Error: cancelled') return 'HiveAuth authentication request cancelled'
  else if (e.cmd === 'auth_nack') return 'HiveAuth authentication request rejected'
  else if (e.cmd === 'sign_nack') return 'HiveAuth broadcast request rejected'
  else if (e.cmd === 'auth_err' || e.cmd === 'sign_err') return e.error
  else return e.toString()
}

const HiveAuthErrorCode = (e: any): number => {
  if (e.toString() === 'Error: expired') return 4002
  else if (e.toString() === 'Error: cancelled' || e.cmd === 'auth_nack' || e.cmd === 'sign_nack') return 4001
  else if (e.cmd === 'auth_err' || e.cmd === 'sign_err') return 5903
  else return 5000
}

const NO_MEMO = 'Memo operations are unavailable in HiveAuth'

export class HiveAuth extends AiohaProviderBase {
  private provider: Auth

  constructor(api: string, emitter: SimpleEventEmitter, options: AppMetaType) {
    super(api, emitter)
    this.provider = new Auth(options)
  }

  async login(username: string, options: LoginOptions): Promise<LoginResult> {
    try {
      const login = await HaWrapper.authenticate(
        this.provider,
        username,
        {
          key_type: options.keyType!,
          challenge: options.msg ?? window.crypto.randomUUID(),
          nonce: Date.now()
        },
        (payload, evt, cancel) => {
          this.eventEmitter.emit('hiveauth_login_request', payload, evt, cancel)
          if (options.hiveauth && typeof options.hiveauth.cbWait === 'function') options.hiveauth.cbWait(payload, evt, cancel)
        }
      )
      if (this.provider.token) localStorage.setItem('hiveauthToken', this.provider.token)
      localStorage.setItem('hiveauthKey', this.provider.key!)
      localStorage.setItem('hiveauthExp', this.provider.expire!.toString())
      return {
        provider: Providers.HiveAuth,
        success: true,
        result: login.challenge.challenge,
        publicKey: login.challenge.pubkey,
        username
      }
    } catch (e) {
      return {
        provider: Providers.HiveAuth,
        success: false,
        errorCode: HiveAuthErrorCode(e),
        error: HiveAuthError(e)
      }
    }
  }

  async loginAndDecryptMemo(username: string, options: LoginOptions): Promise<LoginResult> {
    // return the error
    return {
      provider: Providers.HiveAuth,
      ...(await this.decryptMemo())
    }
  }

  async logout(): Promise<void> {
    this.provider.logout()
    this.rmItems(['hiveauthToken', 'hiveauthKey', 'hiveauthExp'])
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

  getLoginInfo(): PersistentLoginHiveAuth | undefined {
    if (this.getUser())
      return {
        provider: Providers.HiveAuth,
        token: this.provider.token,
        key: this.provider.key!,
        exp: this.provider.expire!
      }
  }

  loadLogin(username: string, info: PersistentLogin): boolean {
    if (info.provider !== Providers.HiveAuth) return false
    const info2 = info as PersistentLoginHiveAuth
    if (info2.token) localStorage.setItem('hiveauthToken', info2.token)
    localStorage.setItem('hiveauthKey', info2.key)
    localStorage.setItem('hiveauthExp', info2.exp.toString())
    return this.loadAuth(username)
  }

  encryptMemo(): Promise<OperationError> {
    return this.decryptMemo()
  }

  encryptMemoWithKeys(): Promise<OperationError> {
    return this.encryptMemo()
  }

  async decryptMemo(): Promise<OperationError> {
    return {
      success: false,
      errorCode: 4200,
      error: NO_MEMO
    }
  }

  async signMessage(message: string, keyType: KeyTypes): Promise<OperationResult> {
    try {
      this.eventEmitter.emit('sign_msg_request')
      const signed = await HaWrapper.challenge(
        this.provider,
        {
          key_type: keyType,
          challenge: message,
          nonce: Date.now()
        },
        (payload, evt, cancel) => {
          this.eventEmitter.emit('hiveauth_challenge_request', payload, evt, cancel)
        }
      )
      return {
        success: true,
        result: signed.challenge,
        publicKey: signed.pubkey
      }
    } catch (e) {
      return {
        success: false,
        errorCode: HiveAuthErrorCode(e),
        error: HiveAuthError(e)
      }
    }
  }

  async signTx(tx: any, keyType: KeyTypes): Promise<SignOperationResultObj> {
    // the HiveAuth sign tx without broadcast implementation at protocol level is not the same as keychain
    // as it only accepts array of tx operations as inputs without tx headers which is not very useful when
    // trying to sign a multisig transaction.
    return {
      success: false,
      errorCode: 4200,
      error: 'Not implemented'
    }
  }

  async signAndBroadcastTx(tx: Operation[], keyType: KeyTypes): Promise<SignOperationResult> {
    try {
      this.emitSignTx()
      const broadcasted = await HaWrapper.signTx(this.provider, keyType, tx, true, (payload, evt, cancel) => {
        this.eventEmitter.emit('hiveauth_sign_request', payload, evt, cancel)
      })
      return {
        success: true,
        result: broadcasted.data
      }
    } catch (e) {
      return {
        success: false,
        errorCode: HiveAuthErrorCode(e),
        error: HiveAuthError(e)
      }
    }
  }
}
