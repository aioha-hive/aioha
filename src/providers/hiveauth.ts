import { CommentOptionsOperation, Operation, WithdrawVestingOperation } from '@hiveio/dhive'
import HaWrapper, { Auth, AppMetaType, KeyType } from '../lib/hiveauth-wrapper.js'
import { AiohaProvider, AiohaProviderBase } from './provider.js'
import { Asset, KeyTypes, LoginOptions, LoginResult, OperationResult, Providers, SignOperationResult } from '../types.js'
import {
  createComment,
  createCustomJSON,
  createRecurrentXfer,
  createVote,
  createXfer,
  deleteComment,
  createStakeHive,
  createUnstakeHive,
  createUnstakeHiveByVests,
  createDelegateVests,
  createVoteWitness,
  createVoteProposals,
  createSetProxy
} from '../opbuilder.js'
import { hivePerVests } from '../rpc.js'
import assert from 'assert'

const HiveAuthError = (e: any): string => {
  if (e.toString() === 'Error: expired') return 'HiveAuth authentication request expired'
  else if (e.cmd === 'auth_nack') return 'HiveAuth authentication request rejected'
  else if (e.cmd === 'sign_nack') return 'HiveAuth broadcast request rejected'
  else if (e.cmd === 'auth_err' || e.cmd === 'sign_err') return e.error
  else return 'Unknown error'
}

export class HiveAuth extends AiohaProviderBase implements AiohaProvider {
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

  async vote(author: string, permlink: string, weight: number): Promise<SignOperationResult> {
    assert(this.provider.username)
    return await this.signAndBroadcastTx([createVote(this.provider.username, author, permlink, weight)], KeyTypes.Posting)
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
    assert(this.provider.username)
    return await this.signAndBroadcastTx(
      createComment(pa, pp, this.provider.username, permlink, title, body, json, options) as Operation[],
      KeyTypes.Posting
    )
  }

  async deleteComment(permlink: string): Promise<SignOperationResult> {
    assert(this.provider.username)
    return await this.signAndBroadcastTx([deleteComment(this.provider.username, permlink)], KeyTypes.Posting)
  }

  async customJSON(keyType: KeyTypes, id: string, json: string): Promise<SignOperationResult> {
    assert(this.provider.username)
    const requiredAuths = keyType === KeyTypes.Active ? [this.provider.username] : []
    const requiredPostingAuths = keyType === KeyTypes.Posting ? [this.provider.username] : []
    return await this.signAndBroadcastTx([createCustomJSON(requiredAuths, requiredPostingAuths, id, json)], keyType)
  }

  async transfer(to: string, amount: number, currency: Asset, memo?: string): Promise<SignOperationResult> {
    assert(this.provider.username)
    return await this.signAndBroadcastTx([createXfer(this.provider.username, to, amount, currency, memo)], KeyTypes.Active)
  }

  async recurrentTransfer(
    to: string,
    amount: number,
    currency: Asset,
    recurrence: number,
    executions: number,
    memo?: string
  ): Promise<SignOperationResult> {
    assert(this.provider.username)
    return await this.signAndBroadcastTx(
      [createRecurrentXfer(this.provider.username, to, amount, currency, recurrence, executions, memo)],
      KeyTypes.Active
    )
  }

  async stakeHive(amount: number, to?: string | undefined): Promise<SignOperationResult> {
    assert(this.provider.username)
    return await this.signAndBroadcastTx(
      [createStakeHive(this.provider.username, to ?? this.provider.username, amount)],
      KeyTypes.Active
    )
  }

  async unstakeHive(amount: number): Promise<SignOperationResult> {
    assert(this.provider.username)
    let op: WithdrawVestingOperation
    try {
      op = await createUnstakeHive(this.provider.username, amount)
    } catch {
      return {
        success: false,
        error: 'Failed to retrieve VESTS from staked HIVE'
      }
    }
    return await this.signAndBroadcastTx([op], KeyTypes.Active)
  }

  async unstakeHiveByVests(vests: number): Promise<SignOperationResult> {
    assert(this.provider.username)
    return await this.signAndBroadcastTx([createUnstakeHiveByVests(this.provider.username, vests)], KeyTypes.Active)
  }

  async delegateStakedHive(to: string, amount: number): Promise<SignOperationResult> {
    assert(this.provider.username)
    let hpv: number
    try {
      hpv = await hivePerVests(this.api)
    } catch {
      return {
        success: false,
        error: 'Failed to retrieve HIVE per VESTS'
      }
    }
    return await this.delegateVests(to, amount / hpv)
  }

  async delegateVests(to: string, amount: number): Promise<SignOperationResult> {
    assert(this.provider.username)
    return await this.signAndBroadcastTx([createDelegateVests(this.provider.username, to, amount)], KeyTypes.Active)
  }

  async voteWitness(witness: string, approve: boolean): Promise<SignOperationResult> {
    assert(this.provider.username)
    return await this.signAndBroadcastTx([createVoteWitness(this.provider.username, witness, approve)], KeyTypes.Active)
  }

  async voteProposals(proposals: number[], approve: boolean): Promise<SignOperationResult> {
    assert(this.provider.username)
    return await this.signAndBroadcastTx([createVoteProposals(this.provider.username, proposals, approve)], KeyTypes.Active)
  }

  async setProxy(proxy: string): Promise<SignOperationResult> {
    assert(this.provider.username)
    return await this.signAndBroadcastTx([createSetProxy(this.provider.username, proxy)], KeyTypes.Active)
  }
}
