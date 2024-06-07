import { KeychainRequestResponse } from 'keychain-sdk'
import { Operation, Transaction, CommentOptionsOperation } from '@hiveio/dhive'
import { AiohaProvider, AiohaProviderBase } from './provider.js'
import {
  Asset,
  KeyTypes,
  KeychainOptions,
  LoginOptions,
  LoginResult,
  OperationResult,
  Providers,
  SignOperationResult
} from '../types.js'
import assert from 'assert'
import { createUnstakeHiveByVests, deleteComment } from '../opbuilder.js'
import { KeychainMini } from '../lib/keychain-mini.js'

enum KeychainKeyTypes {
  posting = 'Posting',
  active = 'Active',
  memo = 'Memo'
}

export class Keychain extends AiohaProviderBase implements AiohaProvider {
  private provider: KeychainMini
  private loginTitle: string = 'Login'
  private username?: string

  constructor(options?: KeychainOptions) {
    super('') // api url isn't used here
    this.provider = new KeychainMini()
    if (options && options.loginTitle) this.loginTitle = options.loginTitle
  }

  async login(username: string, options: LoginOptions): Promise<LoginResult> {
    if (!options || !options.keyType)
      return {
        provider: Providers.Keychain,
        success: false,
        error: 'keyType options are required'
      }
    else if (!(await Keychain.isInstalled()))
      return {
        provider: Providers.Keychain,
        success: false,
        error: 'Keychain extension is not installed'
      }
    const login = await this.provider.login({
      username: username,
      message: options.msg,
      method: Keychain.mapAiohaKeyTypes(options.keyType),
      title: this.loginTitle
    })
    if (login.success) this.username = username
    return {
      provider: Providers.Keychain,
      success: login.success,
      message: login.message,
      result: login.result,
      publicKey: login.publicKey,
      username
    }
  }

  async loginAndDecryptMemo(username: string, options: LoginOptions): Promise<LoginResult> {
    if (!options.msg || !options.msg.startsWith('#'))
      return {
        provider: Providers.Keychain,
        success: false,
        error: 'message to decode must start with #'
      }
    else if (!options || !options.keyType)
      return {
        provider: Providers.Keychain,
        success: false,
        error: 'keyType options are required'
      }
    else if (!(await Keychain.isInstalled()))
      return {
        provider: Providers.Keychain,
        success: false,
        error: 'Keychain extension is not installed'
      }
    const login = await this.provider.decode({
      username: username,
      message: options.msg,
      method: Keychain.mapAiohaKeyTypes(options.keyType)
    })
    if (login.success) this.username = username
    return {
      provider: Providers.Keychain,
      success: login.success,
      message: login.message,
      result: login.result as unknown as string,
      username
    }
  }

  async logout(): Promise<void> {
    delete this.username
  }

  loadAuth(username: string): boolean {
    this.username = username
    return true
  }

  static isInstalled(): Promise<boolean> {
    return new KeychainMini().isKeychainInstalled()
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

  async decryptMemo(memo: string, keyType: KeyTypes): Promise<OperationResult> {
    assert(typeof this.username === 'string')
    const kcKeyType = Keychain.mapAiohaKeyTypes(keyType)
    const decoded = await this.provider.decode({
      username: this.username,
      message: memo,
      method: kcKeyType
    })
    return {
      success: decoded.success,
      error: decoded.error ? decoded.message : undefined,
      result: decoded.result as unknown as string
    }
  }

  async signMessage(message: string, keyType: KeyTypes): Promise<OperationResult> {
    assert(typeof this.username === 'string')
    const kcKeyType = Keychain.mapAiohaKeyTypes(keyType)
    const signBuf = await this.provider.signBuffer({
      username: this.username,
      message,
      method: kcKeyType
    })
    if (!signBuf.success)
      return {
        success: false,
        error: signBuf.error
      }
    return {
      success: signBuf.success,
      message: signBuf.message,
      result: signBuf.result as unknown as string,
      publicKey: signBuf.publicKey
    }
  }

  async signTx(tx: Transaction, keyType: KeyTypes): Promise<SignOperationResult> {
    assert(typeof this.username === 'string')
    const kcKeyType = Keychain.mapAiohaKeyTypes(keyType)
    const signedTx = await this.provider.signTx({
      username: this.username,
      tx,
      method: kcKeyType
    })
    if (!signedTx.success)
      return {
        success: false,
        error: signedTx.error
      }
    return {
      success: signedTx.success,
      message: signedTx.message,
      result: signedTx.result
    }
  }

  async signAndBroadcastTx(tx: Operation[], keyType: KeyTypes): Promise<SignOperationResult> {
    assert(typeof this.username === 'string')
    const kcKeyType = Keychain.mapAiohaKeyTypes(keyType)
    try {
      const broadcastedTx = await this.provider.broadcast({
        username: this.username,
        operations: tx,
        method: kcKeyType
      })
      return this.txResult(broadcastedTx)
    } catch (e) {
      return {
        success: false,
        error: (e as KeychainRequestResponse).message
      }
    }
  }

  txResult(tx: KeychainRequestResponse): SignOperationResult {
    if (!tx.success)
      return {
        success: false,
        error: tx.message
      }
    return {
      success: tx.success,
      message: tx.message,
      result: tx.result!.id
    }
  }

  async vote(author: string, permlink: string, weight: number): Promise<SignOperationResult> {
    assert(typeof this.username === 'string')
    const tx = await this.provider.vote({
      username: this.username,
      author,
      permlink,
      weight
    })
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
    assert(this.username)
    const tx = await this.provider.post({
      username: this.username,
      permlink,
      title,
      body,
      json_metadata: json,
      parent_username: pa ?? '',
      parent_perm: pp ?? '',
      comment_options: options ? JSON.stringify(options) : ''
    })
    return this.txResult(tx)
  }

  async deleteComment(permlink: string): Promise<SignOperationResult> {
    assert(this.username)
    return await this.signAndBroadcastTx([deleteComment(this.username, permlink)], KeyTypes.Posting)
  }

  async customJSON(keyType: KeyTypes, id: string, json: string, displayTitle?: string): Promise<SignOperationResult> {
    assert(this.username)
    return this.txResult(
      await this.provider.custom({
        username: this.username,
        method: Keychain.mapAiohaKeyTypes(keyType),
        display_msg: displayTitle ?? 'Custom JSON',
        id,
        json
      })
    )
  }

  async transfer(to: string, amount: number, currency: Asset, memo?: string): Promise<SignOperationResult> {
    assert(this.username)
    return this.txResult(
      await this.provider.transfer({
        username: this.username,
        to,
        amount: amount.toFixed(3),
        memo: memo ?? '',
        enforce: true,
        currency
      })
    )
  }

  async recurrentTransfer(
    to: string,
    amount: number,
    currency: Asset,
    recurrence: number,
    executions: number,
    memo?: string
  ): Promise<SignOperationResult> {
    assert(this.username)
    return this.txResult(
      await this.provider.recurrentTransfer({
        username: this.username,
        to,
        amount: amount.toFixed(3),
        currency,
        memo: memo ?? '',
        recurrence,
        executions
      })
    )
  }

  async stakeHive(amount: number, to?: string): Promise<SignOperationResult> {
    assert(this.username)
    return this.txResult(
      await this.provider.powerUp({
        username: this.username,
        recipient: to ?? this.username,
        hive: amount.toFixed(3)
      })
    )
  }

  async unstakeHive(amount: number): Promise<SignOperationResult> {
    assert(this.username)
    return this.txResult(
      await this.provider.powerDown({
        username: this.username,
        hive_power: amount.toFixed(3)
      })
    )
  }

  async unstakeHiveByVests(vests: number): Promise<SignOperationResult> {
    assert(this.username)
    return await this.signAndBroadcastTx([createUnstakeHiveByVests(this.username, vests)], KeyTypes.Active)
  }

  async delegateStakedHive(to: string, amount: number): Promise<SignOperationResult> {
    assert(this.username)
    return this.txResult(
      await this.provider.delegation({
        username: this.username,
        delegatee: to,
        amount: amount.toFixed(3),
        unit: 'HP'
      })
    )
  }

  async delegateVests(to: string, amount: number): Promise<SignOperationResult> {
    assert(this.username)
    return this.txResult(
      await this.provider.delegation({
        username: this.username,
        delegatee: to,
        amount: amount.toFixed(6),
        unit: 'VESTS'
      })
    )
  }

  async voteWitness(witness: string, approve: boolean): Promise<SignOperationResult> {
    assert(this.username)
    return this.txResult(
      await this.provider.witnessVote({
        username: this.username,
        witness,
        vote: approve
      })
    )
  }

  async voteProposals(proposals: number[], approve: boolean): Promise<SignOperationResult> {
    assert(this.username)
    return this.txResult(
      await this.provider.updateProposalVote({
        username: this.username,
        proposal_ids: proposals,
        approve,
        extensions: []
      })
    )
  }

  async setProxy(proxy: string): Promise<SignOperationResult> {
    assert(this.username)
    return this.txResult(
      await this.provider.proxy({
        username: this.username,
        proxy
      })
    )
  }
}
