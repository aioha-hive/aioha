import hivesigner, { Client } from 'hivesigner'
import { encodeOps } from 'hive-uri'
import { CommentOptionsOperation, Operation, Transaction, WithdrawVestingOperation } from '@hiveio/dhive'
import { ClientConfig } from 'hivesigner/lib/types/client-config.interface.js'
import { AiohaProvider } from './provider.js'
import { Asset, KeyTypes, LoginOptions, LoginResult, OperationResult, SignOperationResult } from '../types.js'
import { KeyType } from '../lib/hiveauth-wrapper.js'
import assert from 'assert'
import {
  createComment,
  createCustomJSON,
  createDelegateVests,
  createRecurrentXfer,
  createSetProxy,
  createStakeHive,
  createUnstakeHive,
  createUnstakeHiveByVests,
  createVote,
  createVoteProposals,
  createVoteWitness,
  createXfer,
  deleteComment
} from '../opbuilder.js'
import { hivePerVests } from '../rpc.js'

interface HiveSignerError {
  error: 'unauthorized_client' | 'unauthorized_access' | 'invalid_grant' | 'invalid_scope' | 'server_error'
  error_description: string
}

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

export class HiveSigner implements AiohaProvider {
  private provider: Client
  private username?: string

  constructor(options: ClientConfig) {
    if (!options.callbackURL?.startsWith(window.location.origin))
      throw new Error('callback URL must be in the same domain or subdomain as the current page')
    this.provider = new hivesigner.Client(options)
  }

  async login(username: string, options: LoginOptions): Promise<LoginResult> {
    return new Promise((rs) => {
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
              provider: 'hivesigner',
              success: true,
              message: 'HiveSigner authentication success',
              result: token,
              username: loggedInUser
            })
          } else
            rs({
              provider: 'hivesigner',
              success: false,
              error: 'Failed to obtain HiveSigner access token'
            })
        }
      }, 1000)
    })
  }

  async loginAndDecryptMemo(username: string, options: LoginOptions): Promise<LoginResult> {
    if (!options || typeof options.msg !== 'string' || !options.msg.startsWith('#'))
      return {
        provider: 'hivesigner',
        error: 'memo to decode must be a valid string beginning with #, encrypted with @hivesigner public posting key',
        success: false
      }
    const login = await this.login(username, options)
    if (!login.success) return login
    const result = await this.decryptMemo(options.msg, 'posting')
    if (result.success)
      return {
        provider: 'hivesigner',
        success: true,
        message: 'Memo decoded successfully',
        username: login.username,
        result: result.result
      }
    return {
      provider: 'hivesigner',
      error: result.error!,
      success: false
    }
  }

  async logout(): Promise<void> {
    try {
      await this.provider.revokeToken()
      localStorage.removeItem('hivesignerToken')
      localStorage.removeItem('hivesignerExpiry')
      localStorage.removeItem('hivesignerUsername')
      this.provider.removeAccessToken()
      delete this.username
    } catch {}
  }

  getLoginURL(options: LoginOptions, username?: string) {
    return this.provider.getLoginURL((options && options.hivesigner && options.hivesigner.state) ?? '', username)
  }

  loadAuth(): boolean {
    const token = localStorage.getItem('hivesignerToken')
    const exp = localStorage.getItem('hivesignerExpiry')
    const loggedInUser = localStorage.getItem('hivesignerUsername')
    if (!token || !exp || !loggedInUser) return false
    const expSeconds = parseInt(exp)
    if (isNaN(expSeconds) || new Date().getTime() / 1000 >= expSeconds) return false
    this.provider.setAccessToken(token)
    this.username = loggedInUser
    return true
  }

  async decryptMemo(memo: string, keyType: KeyTypes): Promise<OperationResult> {
    if (keyType !== 'posting')
      return {
        success: false,
        error: 'Memo must be decrypted using @hivesigner account posting key'
      }
    const decoded = await this.provider.decode(memo)
    if (decoded.memoDecoded)
      return {
        success: true,
        result: decoded.memoDecoded
      }
    else
      return {
        success: false,
        error: 'Failed to decrypt memo'
      }
  }

  async signMessage(): Promise<OperationResult> {
    return {
      success: false,
      error: 'message signing is unsupported with HiveSigner provider'
    }
  }

  async signTx(tx: Transaction, keyType: KeyType): Promise<OperationResult> {
    return {
      success: false,
      error: 'tx signing without broadcast is currently unsupported with HiveSigner provider'
    }
  }

  async signAndBroadcastTx(tx: Operation[], keyType: KeyType): Promise<SignOperationResult> {
    for (let i in tx) if (!authorizedOps.includes(tx[i][0])) return await this.signTxInWindow(tx)
    try {
      const broadcasted = await this.provider.broadcast(tx)
      return {
        success: true,
        message: 'The transaction has been broadcasted successfully.',
        result: broadcasted.result.id
      }
    } catch (e) {
      const error = e as HiveSignerError
      if (error.error === 'invalid_scope') return await this.signTxInWindow(tx)
      return {
        success: false,
        error: error.error_description ?? 'Failed to broadcast tx due to unknown error'
      }
    }
  }

  private async signTxInWindow(ops: Operation[]): Promise<SignOperationResult> {
    return new Promise<SignOperationResult>((rs) => {
      const signUrl =
        encodeOps(ops).replace('hive://', 'https://hivesigner.com/') +
        `?redirect_uri=${encodeURIComponent(this.provider.callbackURL)}`
      const hsWindow = window.open(signUrl)
      let hsInterval = setInterval(() => {
        if (hsWindow && hsWindow.closed) {
          clearInterval(hsInterval)
          const txid = localStorage.getItem('hivesignerTxId')
          if (txid) {
            rs({
              success: true,
              message: 'The transaction has been broadcasted successfully.',
              result: txid
            })
          } else
            rs({
              success: false,
              error: 'Failed to broadcast transaction.'
            })
        }
      }, 1000)
    })
  }

  private async errorFallback(error: HiveSignerError, ops: Operation[]): Promise<SignOperationResult> {
    if (error.error === 'invalid_scope') return this.signTxInWindow(ops)
    return {
      success: false,
      error: error.error_description
    }
  }

  async vote(author: string, permlink: string, weight: number): Promise<SignOperationResult> {
    assert(typeof this.username === 'string')
    try {
      const tx = await this.provider.vote(this.username, author, permlink, weight)
      return {
        success: true,
        result: tx.result.id
      }
    } catch (e) {
      return await this.errorFallback(e as HiveSignerError, [createVote(this.username, author, permlink, weight)])
    }
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
    if (!options) {
      try {
        const tx = await this.provider.comment(pa ?? '', pp ?? '', this.username, permlink, title, body, json)
        return {
          success: true,
          result: tx.result.id
        }
      } catch (e) {
        return await this.errorFallback(
          e as HiveSignerError,
          createComment(pa, pp, this.username, permlink, title, body, json) as Operation[]
        )
      }
    } else {
      return await this.signAndBroadcastTx(
        createComment(pa, pp, this.username, permlink, title, body, json, options) as Operation[],
        'posting'
      )
    }
  }

  async deleteComment(permlink: string): Promise<SignOperationResult> {
    assert(this.username)
    try {
      const tx = await this.provider.deleteComment(this.username, permlink)
      return {
        success: true,
        result: tx.result.id
      }
    } catch (e) {
      return await this.errorFallback(e as HiveSignerError, [deleteComment(this.username, permlink)])
    }
  }

  async customJSON(keyType: KeyTypes, id: string, json: string): Promise<SignOperationResult> {
    assert(this.username)
    const requiredAuths = keyType === 'active' ? [this.username] : []
    const requiredPostingAuths = keyType === 'posting' ? [this.username] : []
    try {
      const tx = await this.provider.customJson(requiredAuths, requiredPostingAuths, id, json)
      return {
        success: true,
        result: tx.result.id
      }
    } catch (e) {
      return await this.errorFallback(e as HiveSignerError, [createCustomJSON(requiredAuths, requiredPostingAuths, id, json)])
    }
  }

  async transfer(to: string, amount: number, currency: Asset, memo?: string): Promise<SignOperationResult> {
    assert(this.username)
    return await this.signAndBroadcastTx([createXfer(this.username, to, amount, currency, memo)], 'active')
  }

  async recurrentTransfer(
    to: string,
    amount: number,
    currency: Asset,
    recurrence: number,
    executions: number,
    memo?: string | undefined
  ): Promise<SignOperationResult> {
    assert(this.username)
    return await this.signAndBroadcastTx(
      [createRecurrentXfer(this.username, to, amount, currency, recurrence, executions, memo)],
      'active'
    )
  }

  async stakeHive(amount: number, to?: string | undefined): Promise<SignOperationResult> {
    assert(this.username)
    return await this.signAndBroadcastTx([createStakeHive(this.username, to ?? this.username, amount)], 'active')
  }

  async unstakeHive(amount: number): Promise<SignOperationResult> {
    assert(this.username)
    let op: WithdrawVestingOperation
    try {
      op = await createUnstakeHive(this.username, amount)
    } catch {
      return {
        success: false,
        error: 'Failed to retrieve VESTS from staked HIVE'
      }
    }
    return await this.signAndBroadcastTx([op], 'active')
  }

  async unstakeHiveByVests(vests: number): Promise<SignOperationResult> {
    assert(this.username)
    return await this.signAndBroadcastTx([createUnstakeHiveByVests(this.username, vests)], 'active')
  }

  async delegateStakedHive(to: string, amount: number): Promise<SignOperationResult> {
    assert(this.username)
    let hpv: number
    try {
      hpv = await hivePerVests()
    } catch {
      return {
        success: false,
        error: 'Failed to retrieve HIVE per VESTS'
      }
    }
    return await this.delegateVests(to, amount / hpv)
  }

  async delegateVests(to: string, amount: number): Promise<SignOperationResult> {
    assert(this.username)
    return await this.signAndBroadcastTx([createDelegateVests(this.username, to, amount)], 'active')
  }

  async voteWitness(witness: string, approve: boolean): Promise<SignOperationResult> {
    assert(this.username)
    return await this.signAndBroadcastTx([createVoteWitness(this.username, witness, approve)], 'active')
  }

  async voteProposals(proposals: number[], approve: boolean): Promise<SignOperationResult> {
    assert(this.username)
    return await this.signAndBroadcastTx([createVoteProposals(this.username, proposals, approve)], 'active')
  }

  async setProxy(proxy: string): Promise<SignOperationResult> {
    assert(this.username)
    return await this.signAndBroadcastTx([createSetProxy(this.username, proxy)], 'active')
  }
}
