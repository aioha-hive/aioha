import type { CommentOptionsOperation, LegacyOperation, LegacyTransaction } from '@aioha/types/dist/hive/legacy.js'
import { AiohaProviderBase } from './provider.js'
import {
  Asset,
  KeyTypes,
  LoginOptions,
  LoginResult,
  OperationResult,
  OperationResultObj,
  Providers,
  SignOperationResult,
  PersistentLoginBase,
  SignOperationResultObj,
  AuthAction,
  AuthType
} from '../types.js'
import type { AiohaClient } from '../rpc.js'
import { KeychainMini, KeychainResponse, KeychainSignTxResponse, KT, p, wk } from '../lib/keychain-mini.js'
import { SimpleEventEmitter } from '../lib/event-emitter.js'
import { error, loginError } from '../lib/errors.js'

const getErrorCode = (resp: any): number => {
  if (typeof resp.error === 'string' && resp.error === 'user_cancel') return 4001
  else if (typeof resp.error === 'object' && typeof resp.error.code === 'number') return resp.error.code
  else return 5000
}

const NOT_INSTALLED_ERR = 'Keychain extension is not installed'

const roleMap: Record<KeyTypes, KT> = {
  owner: KT.owner,
  active: KT.active,
  posting: KT.posting,
  memo: KT.memo
}

export class Keychain extends AiohaProviderBase {
  private provider: KeychainMini
  private username: string

  constructor(rpc: AiohaClient, emitter: SimpleEventEmitter) {
    super(rpc, emitter) // api url isn't used here
    this.provider = new KeychainMini()
    this.username = ''
  }

  async login(username: string, options: LoginOptions): Promise<LoginResult> {
    if (!Keychain.isInstalled()) return loginError(5001, NOT_INSTALLED_ERR, Providers.Keychain)
    this.emitLoginReq()
    const login: any = await this.provider.challenge(
      false,
      username,
      options.msg ?? '',
      roleMap[options.keyType!],
      options.loginTitle
    )
    if (login.success) this.username = username
    return {
      provider: Providers.Keychain,
      success: login.success,
      error: !login.success ? login.message : undefined,
      result: login.result,
      publicKey: login.publicKey,
      username
    }
  }

  async loginAndDecryptMemo(username: string, options: LoginOptions): Promise<LoginResult> {
    if (!Keychain.isInstalled()) return loginError(5001, NOT_INSTALLED_ERR, Providers.Keychain)
    this.emitLoginReq()
    const login = await this.provider.challenge(true, username, options.msg!, roleMap[options.keyType!])
    if (login.success) this.username = username
    if (login.success) {
      return {
        provider: Providers.Keychain,
        success: true,
        result: login.result as unknown as string,
        username
      }
    }
    return loginError(getErrorCode(login), login.message, Providers.Keychain)
  }

  async logout(): Promise<void> {
    this.username = ''
  }

  loadAuth(username: string): boolean {
    this.username = username
    return true
  }

  getUser(): string | undefined {
    return this.username
  }

  getLoginInfo(): PersistentLoginBase | undefined {
    if (this.getUser()) return { provider: Providers.Keychain }
  }

  loadLogin(username: string): boolean {
    return this.loadAuth(username)
  }

  static isInstalled(): boolean {
    return !!window.hive_keychain
  }

  async encryptMemo(message: string, keyType: KeyTypes, recipient: string): Promise<OperationResult> {
    this.emitMemoReq()
    const encoded = await this.provider.encode(false, this.getUser()!, recipient, message, roleMap[keyType])
    if (encoded.success)
      return {
        success: true,
        result: encoded.result as unknown as string
      }
    else return error(getErrorCode(encoded), encoded.message)
  }

  async encryptMemoWithKeys(message: string, keyType: KeyTypes, recipientKeys: string[]): Promise<OperationResultObj> {
    this.emitMemoReq()
    const encoded = await this.provider.encode(true, this.getUser()!, recipientKeys, message, roleMap[keyType])
    if (encoded.success)
      return {
        success: true,
        result: encoded.result as unknown as object
      }
    else return error(getErrorCode(encoded), encoded.message)
  }

  async decryptMemo(memo: string, keyType: KeyTypes): Promise<OperationResult> {
    this.emitMemoReq()
    const decoded = await this.provider.challenge(true, this.getUser()!, memo, roleMap[keyType])
    if (decoded.success)
      return {
        success: true,
        result: decoded.result as unknown as string
      }
    else return error(getErrorCode(decoded), decoded.message)
  }

  async signMessage(message: string, keyType: KeyTypes): Promise<OperationResult> {
    this.eventEmitter.emit('sign_msg_request')
    const signBuf = await this.provider.challenge(false, this.getUser()!, message, roleMap[keyType])
    if (!signBuf.success) return error(getErrorCode(signBuf), signBuf.error)
    return {
      success: signBuf.success,
      result: signBuf.result as unknown as string,
      publicKey: signBuf.publicKey
    }
  }

  async signTx(tx: LegacyTransaction, keyType: KeyTypes): Promise<SignOperationResultObj> {
    this.emitSignTx()
    const signedTx = await p<KeychainSignTxResponse>((r) =>
      wk().requestSignTx(this.username, tx, roleMap[keyType], (res: KeychainSignTxResponse) => r(res))
    )
    if (!signedTx.success) return error(getErrorCode(signedTx), signedTx.error)
    return {
      success: signedTx.success,
      result: signedTx.result
    }
  }

  async signAndBroadcastTx(tx: LegacyOperation[], keyType: KeyTypes): Promise<SignOperationResult> {
    try {
      this.emitSignTx()
      const broadcastedTx = await p((r) => {
        wk().requestBroadcast(this.username, tx, roleMap[keyType], (res: KeychainResponse) => r(res))
      })
      return this.txResult(broadcastedTx)
    } catch (e) {
      return error(getErrorCode(e), (e as KeychainResponse).message)
    }
  }

  txResult(tx: KeychainResponse): SignOperationResult {
    if (!tx.success) return error(getErrorCode(tx), tx.message)
    return {
      success: tx.success,
      result: tx.result!.id
    }
  }

  async vote(author: string, permlink: string, weight: number): Promise<SignOperationResult> {
    this.emitSignTx()
    const tx = await p((r) => wk().requestVote(this.username, permlink, author, weight, (res: KeychainResponse) => r(res)))
    return this.txResult(tx)
  }

  async comment(
    pa: string | null,
    pp: string | null,
    permlink: string,
    title: string,
    body: string,
    json: string,
    options?: CommentOptionsOperation[1] | undefined
  ): Promise<SignOperationResult> {
    // remove when and if keychain fixes this issue
    if (pa && pp) return await super.comment(pa, pp, permlink, title, body, json, options)
    this.emitSignTx()
    const tx = await p((r) => {
      wk().requestPost(
        this.username,
        title,
        body,
        pp,
        pa,
        json,
        permlink,
        options ? JSON.stringify(options) : '',
        (res: KeychainResponse) => r(res)
      )
    })
    return this.txResult(tx)
  }

  async customJSON(keyType: KeyTypes, id: string, json: string, displayTitle?: string): Promise<SignOperationResult> {
    this.emitSignTx()
    return this.txResult(
      await p((r) => {
        wk().requestCustomJson(
          this.username,
          id,
          roleMap[keyType],
          json,
          displayTitle ?? 'Custom JSON',
          (res: KeychainResponse) => r(res)
        )
      })
    )
  }

  async transfer(to: string, amount: number, currency: Asset, memo?: string): Promise<SignOperationResult> {
    this.emitSignTx()
    return this.txResult(
      await p((r) => {
        wk().requestTransfer(this.username, to, amount.toFixed(3), memo ?? '', currency, (res: KeychainResponse) => r(res), true)
      })
    )
  }

  async recurrentTransfer(
    to: string,
    amount: number,
    currency: Asset,
    recurrence: number,
    executions: number,
    memo?: string,
    pair_id?: number
  ): Promise<SignOperationResult> {
    this.emitSignTx()
    return this.txResult(
      await p((r) => {
        wk().requestRecurrentTransfer(
          this.username,
          to,
          amount.toFixed(3),
          currency,
          memo ?? '',
          recurrence,
          executions,
          (res: KeychainResponse) => r(res),
          undefined,
          pair_id
        )
      })
    )
  }

  async stakeHive(amount: number, to?: string): Promise<SignOperationResult> {
    this.emitSignTx()
    return this.txResult(
      await p((r) => {
        wk().requestPowerUp(this.username, to ?? this.username, amount.toFixed(3), (res: KeychainResponse) => r(res))
      })
    )
  }

  async unstakeHive(amount: number): Promise<SignOperationResult> {
    this.emitSignTx()
    return this.txResult(
      await p((r) => wk().requestPowerDown(this.username, amount.toFixed(3), (res: KeychainResponse) => r(res)))
    )
  }

  async delegateStakedHive(to: string, amount: number): Promise<SignOperationResult> {
    this.emitSignTx()
    return this.txResult(await this.provider.delegation(this.username, to, amount.toFixed(3), 'HP'))
  }

  async delegateVests(to: string, amount: number): Promise<SignOperationResult> {
    this.emitSignTx()
    return this.txResult(await this.provider.delegation(this.username, to, amount.toFixed(6), 'VESTS'))
  }

  async voteWitness(witness: string, approve: boolean): Promise<SignOperationResult> {
    this.emitSignTx()
    return this.txResult(
      await p((r) => wk().requestWitnessVote(this.username, witness, approve, (res: KeychainResponse) => r(res)))
    )
  }

  async voteProposals(proposals: number[], approve: boolean): Promise<SignOperationResult> {
    this.emitSignTx()
    return this.txResult(
      await p((r) => wk().requestUpdateProposalVote(this.username, proposals, approve, [], (res: KeychainResponse) => r(res)))
    )
  }

  async setProxy(proxy: string): Promise<SignOperationResult> {
    this.emitSignTx()
    return this.txResult(await p((r) => wk().requestProxy(this.username, proxy, (res: KeychainResponse) => r(res))))
  }

  async modifyAuth(
    action: AuthAction,
    type: AuthType,
    theAuth: string,
    role: KeyTypes,
    weight: number
  ): Promise<SignOperationResult> {
    this.emitSignTx()
    const t = type === AuthType.Account ? 'Account' : 'Key'
    switch (action) {
      case AuthAction.Add:
        return this.txResult(await this.provider.addAuth(t, this.getUser()!, theAuth, roleMap[role], weight))
      case AuthAction.Remove:
        return this.txResult(await this.provider.rmAuth(t, this.getUser()!, theAuth, roleMap[role]))
    }
  }
}
