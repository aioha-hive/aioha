import { Operation, Transaction, CommentOptionsOperation } from '@hiveio/dhive'
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
  VscStakeType,
  SignOperationResultObj
} from '../types.js'
import { KeychainMini, KeychainRequestResponse, KT } from '../lib/keychain-mini.js'
import { SimpleEventEmitter } from '../lib/event-emitter.js'
import { error, loginError } from '../lib/errors.js'

const getErrorCode = (resp: any): number => {
  if (typeof resp.error === 'string' && resp.error === 'user_cancel') return 4001
  else if (typeof resp.error === 'object' && typeof resp.error.code === 'number') return resp.error.code
  else return 5000
}

const roleMap: Record<KeyTypes, KT> = {
  owner: KT.owner,
  active: KT.active,
  posting: KT.posting,
  memo: KT.memo
}

export class Keychain extends AiohaProviderBase {
  private provider: KeychainMini
  private username: string

  constructor(emitter: SimpleEventEmitter) {
    super('', emitter) // api url isn't used here
    this.provider = new KeychainMini()
    this.username = ''
  }

  async login(username: string, options: LoginOptions): Promise<LoginResult> {
    if (!KeychainMini.isInstalledSync()) return loginError(5001, 'Keychain extension is not installed', Providers.Keychain)
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
    if (!KeychainMini.isInstalledSync()) return loginError(5001, 'Keychain extension is not installed', Providers.Keychain)
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
    return KeychainMini.isInstalledSync()
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

  async signTx(tx: Transaction, keyType: KeyTypes): Promise<SignOperationResultObj> {
    this.emitSignTx()
    const signedTx = await this.provider.signTx(this.username, tx, roleMap[keyType])
    if (!signedTx.success) return error(getErrorCode(signedTx), signedTx.error)
    return {
      success: signedTx.success,
      result: signedTx.result
    }
  }

  async signAndBroadcastTx(tx: Operation[], keyType: KeyTypes): Promise<SignOperationResult> {
    try {
      this.emitSignTx()
      const broadcastedTx = await this.provider.broadcast(this.username, tx, roleMap[keyType])
      return this.txResult(broadcastedTx)
    } catch (e) {
      return error(getErrorCode(e), (e as KeychainRequestResponse).message)
    }
  }

  txResult(tx: KeychainRequestResponse): SignOperationResult {
    if (!tx.success) return error(getErrorCode(tx), tx.message)
    return {
      success: tx.success,
      result: tx.result!.id
    }
  }

  async vote(author: string, permlink: string, weight: number): Promise<SignOperationResult> {
    this.emitSignTx()
    const tx = await this.provider.vote(this.username, author, permlink, weight)
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
    const tx = await this.provider.post(
      this.username,
      title,
      body,
      pp ?? '',
      pa ?? '',
      json,
      permlink,
      options ? JSON.stringify(options) : ''
    )
    return this.txResult(tx)
  }

  async customJSON(keyType: KeyTypes, id: string, json: string, displayTitle?: string): Promise<SignOperationResult> {
    this.emitSignTx()
    return this.txResult(await this.provider.custom(this.username, roleMap[keyType], id, json, displayTitle ?? 'Custom JSON'))
  }

  async transfer(to: string, amount: number, currency: Asset, memo?: string): Promise<SignOperationResult> {
    this.emitSignTx()
    return this.txResult(await this.provider.transfer(this.username, to, amount.toFixed(3), currency, memo ?? ''))
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
      await this.provider.recurrentTransfer(
        this.username,
        to,
        amount.toFixed(3),
        currency,
        memo ?? '',
        recurrence,
        executions,
        pair_id
      )
    )
  }

  async stakeHive(amount: number, to?: string): Promise<SignOperationResult> {
    this.emitSignTx()
    return this.txResult(await this.provider.powerUp(this.username, to ?? this.username, amount.toFixed(3)))
  }

  async unstakeHive(amount: number): Promise<SignOperationResult> {
    this.emitSignTx()
    return this.txResult(await this.provider.powerDown(this.username, amount.toFixed(3)))
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
    return this.txResult(await this.provider.witnessVote(this.username, witness, approve))
  }

  async voteProposals(proposals: number[], approve: boolean): Promise<SignOperationResult> {
    this.emitSignTx()
    return this.txResult(await this.provider.updateProposalVote(this.username, proposals, approve))
  }

  async setProxy(proxy: string): Promise<SignOperationResult> {
    this.emitSignTx()
    return this.txResult(await this.provider.proxy(this.username, proxy))
  }

  async addAccountAuthority(username: string, role: KeyTypes, weight: number): Promise<SignOperationResult> {
    this.emitSignTx()
    return this.txResult(await this.provider.addAuth('Account', this.getUser()!, username, roleMap[role], weight))
  }

  async removeAccountAuthority(username: string, role: KeyTypes): Promise<SignOperationResult> {
    this.emitSignTx()
    return this.txResult(await this.provider.rmAuth('Account', this.getUser()!, username, roleMap[role]))
  }

  async addKeyAuthority(publicKey: string, role: KeyTypes, weight: number): Promise<SignOperationResult> {
    this.emitSignTx()
    return this.txResult(await this.provider.addAuth('Key', this.getUser()!, publicKey, roleMap[role], weight))
  }

  async removeKeyAuthority(publicKey: string, role: KeyTypes): Promise<SignOperationResult> {
    this.emitSignTx()
    return this.txResult(await this.provider.rmAuth('Key', this.getUser()!, publicKey, roleMap[role]))
  }

  async vscTransfer(to: string, amount: number, currency: Asset, memo?: string): Promise<SignOperationResult> {
    this.emitSignTx()
    return this.txResult(await this.provider.vscFer('Transfer', this.getUser()!, to, amount, currency, memo))
  }

  async vscWithdraw(to: string, amount: number, currency: Asset, memo?: string): Promise<SignOperationResult> {
    this.emitSignTx()
    return this.txResult(await this.provider.vscFer('Withdrawal', this.getUser()!, to, amount, currency, memo))
  }

  async vscStake(
    stakeType: VscStakeType,
    amount: number,
    to?: string,
    memo?: string,
    net_id?: string
  ): Promise<SignOperationResult> {
    switch (stakeType) {
      case VscStakeType.Consensus:
        return super.vscStake(stakeType, amount, to, memo, net_id)
      case VscStakeType.HBD:
        this.emitSignTx()
        return this.txResult(
          await this.provider.vscFer('Staking', this.getUser()!, to ?? this.getUser()!, amount, Asset.HBD, 'STAKING')
        )
    }
  }

  async vscUnstake(
    stakeType: VscStakeType,
    amount: number,
    to?: string,
    memo?: string,
    net_id?: string
  ): Promise<SignOperationResult> {
    switch (stakeType) {
      case VscStakeType.Consensus:
        return super.vscUnstake(stakeType, amount, to, memo, net_id)
      case VscStakeType.HBD:
        this.emitSignTx()
        return this.txResult(
          await this.provider.vscFer('Staking', this.getUser()!, to ?? this.getUser()!, amount, Asset.HBD, 'UNSTAKING')
        )
    }
  }
}
