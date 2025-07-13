import { KeychainRequestResponse } from 'keychain-sdk'
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
  VscStakeType
} from '../types.js'
import { KeychainMini } from '../lib/keychain-mini.js'
import { SimpleEventEmitter } from '../lib/event-emitter.js'

enum KeychainKeyTypes {
  posting = 'Posting',
  active = 'Active',
  memo = 'Memo'
}

const getErrorCode = (resp: any): number => {
  if (typeof resp.error === 'string' && resp.error === 'user_cancel') return 4001
  else if (typeof resp.error === 'object' && typeof resp.error.code === 'number') return resp.error.code
  else return 5000
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
    if (!options || !options.keyType)
      return {
        provider: Providers.Keychain,
        success: false,
        errorCode: 5003,
        error: 'keyType options are required'
      }
    else if (!KeychainMini.isInstalledSync())
      return {
        provider: Providers.Keychain,
        success: false,
        errorCode: 5001,
        error: 'Keychain extension is not installed'
      }
    this.eventEmitter.emit('login_request')
    const login: any = await this.provider.challenge(
      false,
      username,
      options.msg ?? '',
      Keychain.mapAiohaKeyTypes(options.keyType),
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
    if (!options || !options.keyType)
      return {
        provider: Providers.Keychain,
        success: false,
        errorCode: 5003,
        error: 'keyType options are required'
      }
    else if (!KeychainMini.isInstalledSync())
      return {
        provider: Providers.Keychain,
        success: false,
        errorCode: 5001,
        error: 'Keychain extension is not installed'
      }
    this.eventEmitter.emit('login_request')
    const login = await this.provider.challenge(true, username, options.msg!, Keychain.mapAiohaKeyTypes(options.keyType))
    if (login.success) this.username = username
    if (login.success) {
      return {
        provider: Providers.Keychain,
        success: true,
        result: login.result as unknown as string,
        username
      }
    }
    return {
      provider: Providers.Keychain,
      success: false,
      errorCode: getErrorCode(login),
      error: login.message
    }
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

  static mapAiohaKeyTypes(keyType: KeyTypes): KeychainKeyTypes {
    switch (keyType) {
      case KeyTypes.Posting:
        return KeychainKeyTypes.posting
      case KeyTypes.Active:
        return KeychainKeyTypes.active
      case KeyTypes.Memo:
        return KeychainKeyTypes.memo
    }
  }

  async encryptMemo(message: string, keyType: KeyTypes, recipient: string): Promise<OperationResult> {
    this.eventEmitter.emit('memo_request')
    const kcKeyType = Keychain.mapAiohaKeyTypes(keyType)
    const encoded = await this.provider.encode(false, this.getUser()!, recipient, message, kcKeyType)
    if (encoded.success)
      return {
        success: true,
        result: encoded.result as unknown as string
      }
    else
      return {
        success: false,
        errorCode: getErrorCode(encoded),
        error: encoded.message
      }
  }

  async encryptMemoWithKeys(message: string, keyType: KeyTypes, recipientKeys: string[]): Promise<OperationResultObj> {
    this.eventEmitter.emit('memo_request')
    const kcKeyType = Keychain.mapAiohaKeyTypes(keyType)
    const encoded = await this.provider.encode(true, this.getUser()!, recipientKeys, message, kcKeyType)
    if (encoded.success)
      return {
        success: true,
        result: encoded.result as unknown as object
      }
    else
      return {
        success: false,
        errorCode: getErrorCode(encoded),
        error: encoded.message
      }
  }

  async decryptMemo(memo: string, keyType: KeyTypes): Promise<OperationResult> {
    this.eventEmitter.emit('memo_request')
    const kcKeyType = Keychain.mapAiohaKeyTypes(keyType)
    const decoded = await this.provider.challenge(true, this.getUser()!, memo, kcKeyType)
    if (decoded.success)
      return {
        success: true,
        result: decoded.result as unknown as string
      }
    else
      return {
        success: false,
        errorCode: getErrorCode(decoded),
        error: decoded.message
      }
  }

  async signMessage(message: string, keyType: KeyTypes): Promise<OperationResult> {
    this.eventEmitter.emit('sign_msg_request')
    const kcKeyType = Keychain.mapAiohaKeyTypes(keyType)
    const signBuf = await this.provider.challenge(false, this.getUser()!, message, kcKeyType)
    if (!signBuf.success)
      return {
        success: false,
        errorCode: getErrorCode(signBuf),
        error: signBuf.error
      }
    return {
      success: signBuf.success,
      result: signBuf.result as unknown as string,
      publicKey: signBuf.publicKey
    }
  }

  async signTx(tx: Transaction, keyType: KeyTypes): Promise<SignOperationResult> {
    this.emitSignTx()
    const kcKeyType = Keychain.mapAiohaKeyTypes(keyType)
    const signedTx = await this.provider.signTx(this.username, tx, kcKeyType)
    if (!signedTx.success)
      return {
        success: false,
        errorCode: getErrorCode(signedTx),
        error: signedTx.error
      }
    return {
      success: signedTx.success,
      result: signedTx.result
    }
  }

  async signAndBroadcastTx(tx: Operation[], keyType: KeyTypes): Promise<SignOperationResult> {
    const kcKeyType = Keychain.mapAiohaKeyTypes(keyType)
    try {
      this.emitSignTx()
      const broadcastedTx = await this.provider.broadcast(this.username, tx, kcKeyType)
      return this.txResult(broadcastedTx)
    } catch (e) {
      return {
        success: false,
        errorCode: getErrorCode(e),
        error: (e as KeychainRequestResponse).message
      }
    }
  }

  txResult(tx: KeychainRequestResponse): SignOperationResult {
    if (!tx.success)
      return {
        success: false,
        errorCode: getErrorCode(tx),
        error: tx.message
      }
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
    return this.txResult(
      await this.provider.custom(this.username, Keychain.mapAiohaKeyTypes(keyType), id, json, displayTitle ?? 'Custom JSON')
    )
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
    memo?: string
  ): Promise<SignOperationResult> {
    this.emitSignTx()
    return this.txResult(
      await this.provider.recurrentTransfer(this.username, to, amount.toFixed(3), currency, memo ?? '', recurrence, executions)
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
    return this.txResult(
      await this.provider.addAuth('Account', this.getUser()!, username, Keychain.mapAiohaKeyTypes(role), weight)
    )
  }

  async removeAccountAuthority(username: string, role: KeyTypes): Promise<SignOperationResult> {
    this.emitSignTx()
    return this.txResult(await this.provider.rmAuth('Account', this.getUser()!, username, Keychain.mapAiohaKeyTypes(role)))
  }

  async addKeyAuthority(publicKey: string, role: KeyTypes, weight: number): Promise<SignOperationResult> {
    this.emitSignTx()
    return this.txResult(await this.provider.addAuth('Key', this.getUser()!, publicKey, Keychain.mapAiohaKeyTypes(role), weight))
  }

  async removeKeyAuthority(publicKey: string, role: KeyTypes): Promise<SignOperationResult> {
    this.emitSignTx()
    return this.txResult(await this.provider.rmAuth('Key', this.getUser()!, publicKey, Keychain.mapAiohaKeyTypes(role)))
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
