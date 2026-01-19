import { Client } from '../lib/hivesigner.js'
import { encodeOps } from '../lib/hive-uri.js'
import { Operation, Transaction } from '@hiveio/dhive'
import { HiveSignerError, ClientConfig } from '../lib/hivesigner-types.js'
import { AiohaProviderBase } from './provider.js'
import type { AiohaClient } from '../rpc.js'
import {
  KeyTypes,
  LoginOptions,
  LoginOptionsNI,
  LoginResult,
  OperationError,
  OperationResult,
  PersistentLogin,
  PersistentLoginHiveSigner,
  Providers,
  SignOperationResult,
  SignOperationResultObj
} from '../types.js'
import { SimpleEventEmitter } from '../lib/event-emitter.js'
import { error, loginError } from '../lib/errors.js'

// https://github.com/ecency/hivesigner-api/blob/9fa9f51f319b5d9f9d86a4a028fcdf71b10b7836/config.json
const authorizedOps = [
  'vote',
  'comment',
  'delete_comment',
  'comment_options',
  'custom_json',
  'claim_reward_balance',
  'account_update2'
]

const getErrorCode = (error: HiveSignerError['error']): number => {
  if (error === 'server_error') return -32603
  else return 4100
}

const isExpired = (tsSec: number): boolean => {
  return isNaN(tsSec) || new Date().getTime() / 1000 >= tsSec
}

export class HiveSigner extends AiohaProviderBase {
  private provider: Client
  private username?: string

  constructor(rpc: AiohaClient, emitter: SimpleEventEmitter, options: ClientConfig) {
    super(rpc, emitter)
    if (!options.callbackURL?.startsWith(window.location.origin))
      throw new Error('callback URL must be in the same domain or subdomain as the current page')
    this.provider = new Client(options)
  }

  async login(username: string, options: LoginOptions): Promise<LoginResult> {
    return new Promise((rs) => {
      this.emitLoginReq()
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
            this.username = loggedInUser
            rs({
              provider: Providers.HiveSigner,
              success: true,
              result: token,
              username: loggedInUser
            })
          } else rs(loginError(5000, 'Failed to obtain HiveSigner access token', Providers.HiveSigner))
        }
      }, 1000)
    })
  }

  async loginAndDecryptMemo(username: string, options: LoginOptions): Promise<LoginResult> {
    const login = await this.login(username, options)
    if (!login.success) return login
    const result = await this.decryptMemo(options.msg!, KeyTypes.Posting)
    if (result.success)
      return {
        provider: Providers.HiveSigner,
        success: true,
        username: login.username,
        result: result.result
      }
    return loginError(5000, result.error!, Providers.HiveSigner)
  }

  loginNonInteractive(username: string, options: LoginOptionsNI): LoginResult {
    if (
      !options ||
      !options.hivesigner ||
      typeof options.hivesigner.accessToken !== 'string' ||
      typeof options.hivesigner.expiry !== 'number'
    )
      return loginError(5003, 'hivesigner options are required', Providers.HiveSigner)
    else if (isExpired(options.hivesigner.expiry)) return loginError(5003, 'already expired', Providers.HiveSigner)
    this.provider.setAccessToken(options.hivesigner.accessToken)
    this.username = username
    localStorage.setItem('hivesignerToken', options.hivesigner.accessToken)
    localStorage.setItem('hivesignerExpiry', options.hivesigner.expiry.toString())
    localStorage.setItem('hivesignerUsername', username)
    return {
      provider: Providers.HiveSigner,
      success: true,
      result: '',
      username
    }
  }

  async logout(): Promise<void> {
    try {
      await this.provider.revokeToken()
      this.rmItems(['hivesignerToken', 'hivesignerExpiry', 'hivesignerUsername'])
      this.provider.removeAccessToken()
      delete this.username
    } catch {}
  }

  getLoginURL(options: LoginOptions, username?: string) {
    return this.provider.getLoginURL((options && options.hivesigner && options.hivesigner.state) ?? '', username)
  }

  loadAuth(username: string): boolean {
    const token = localStorage.getItem('hivesignerToken')
    const exp = localStorage.getItem('hivesignerExpiry')
    const loggedInUser = localStorage.getItem('hivesignerUsername')
    if (!token || !exp || !loggedInUser || loggedInUser !== username) return false
    const expSeconds = parseInt(exp)
    if (isExpired(expSeconds)) return false
    this.provider.setAccessToken(token)
    this.username = loggedInUser
    return true
  }

  getUser(): string | undefined {
    return this.username
  }

  getLoginInfo(): PersistentLoginHiveSigner | undefined {
    if (this.getUser())
      return {
        provider: Providers.HiveSigner,
        token: this.provider.accessToken!,
        exp: parseInt(localStorage.getItem('hivesignerExpiry')!) * 1000
      }
  }

  loadLogin(username: string, info: PersistentLogin): boolean {
    if (info.provider !== Providers.HiveSigner) return false
    const info2 = info as PersistentLoginHiveSigner
    return this.loginNonInteractive(username, {
      hivesigner: {
        accessToken: info2.token,
        expiry: info2.exp / 1000
      }
    }).success
  }

  async encryptMemo(): Promise<OperationError> {
    return error(4200, 'Memo encryption is not supported in HiveSigner')
  }

  encryptMemoWithKeys(): Promise<OperationError> {
    return this.encryptMemo()
  }

  async decryptMemo(memo: string, keyType: KeyTypes): Promise<OperationResult> {
    if (keyType !== KeyTypes.Posting) return error(5005, 'Memo must be decrypted using @hivesigner account posting key')
    const decoded = await this.provider.decode(memo)
    if (decoded.memoDecoded)
      return {
        success: true,
        result: decoded.memoDecoded
      }
    else return error(5000, 'Failed to decrypt memo')
  }

  async signMessage(): Promise<OperationResult> {
    return error(4200, 'message signing is unsupported in HiveSigner')
  }

  async signTx(tx: Transaction, keyType: KeyTypes): Promise<SignOperationResultObj> {
    return error(4200, 'tx signing without broadcast is unsupported in HiveSigner')
  }

  async signAndBroadcastTx(tx: Operation[], keyType: KeyTypes): Promise<SignOperationResult> {
    for (let i in tx) if (!authorizedOps.includes(tx[i][0])) return await this.signTxInWindow(tx)
    try {
      const broadcasted = await this.provider.broadcast(tx)
      return {
        success: true,
        result: broadcasted.result.id
      }
    } catch (e) {
      const err = e as HiveSignerError
      if (err.error === 'invalid_scope') return await this.signTxInWindow(tx)
      return error(
        err.error_description ? getErrorCode(err.error) : 5000,
        err.error_description ?? 'Failed to broadcast tx due to unknown error'
      )
    }
  }

  private async signTxInWindow(ops: Operation[]): Promise<SignOperationResult> {
    return new Promise<SignOperationResult>((rs) => {
      this.emitSignTx()
      const signUrl =
        encodeOps(ops).replace('hive://', 'https://hivesigner.com/') +
        `?redirect_uri=${encodeURIComponent(this.provider.callbackURL)}`
      const oldTxid = localStorage.getItem('hivesignerTxId')
      const hsWindow = window.open(signUrl)
      let hsInterval = setInterval(() => {
        if (hsWindow && hsWindow.closed) {
          clearInterval(hsInterval)
          const txid = localStorage.getItem('hivesignerTxId')
          if (txid && txid !== oldTxid) {
            rs({
              success: true,
              result: txid
            })
          } else rs(error(5000, 'Failed to broadcast transaction.'))
        }
      }, 1000)
    })
  }
}
