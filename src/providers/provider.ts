import { AuthorityType, CommentOptionsOperation, Operation, Transaction, WithdrawVestingOperation } from '@hiveio/dhive'
import { Asset, KeyTypes, LoginOptions, LoginOptionsNI, LoginResult, OperationResult, SignOperationResult } from '../types.js'
import {
  createVote,
  createComment,
  createCustomJSON,
  createXfer,
  createRecurrentXfer,
  createStakeHive,
  createUnstakeHive,
  createUnstakeHiveByVests,
  createDelegateVests,
  createVoteWitness,
  createVoteProposals,
  createSetProxy,
  deleteComment
} from '../opbuilder.js'
import { hivePerVests, getAccounts, getAccountsErrored } from '../rpc.js'
import { RequestArguments, AiohaRpcError } from '../jsonrpc/eip1193-types.js'

export abstract class AiohaProviderBase implements AiohaOperations {
  protected api: string

  constructor(api: string) {
    this.api = api
  }

  setApi(api: string) {
    this.api = api
  }

  abstract login(username: string, options: LoginOptions): Promise<LoginResult>
  abstract loginAndDecryptMemo(username: string, options: LoginOptions): Promise<LoginResult>
  abstract logout(): Promise<void>
  abstract loadAuth(username: string): boolean
  abstract getUser(): string | undefined
  abstract decryptMemo(memo: string, keyType: KeyTypes): Promise<OperationResult>
  abstract signMessage(message: string, keyType: KeyTypes): Promise<OperationResult>
  abstract signTx(tx: Transaction, keyType: KeyTypes): Promise<SignOperationResult>
  abstract signAndBroadcastTx(tx: Operation[], keyType: KeyTypes): Promise<SignOperationResult>

  loginNonInteractive(username: string, options: LoginOptionsNI): LoginResult {
    return {
      success: false,
      errorCode: 4200,
      error: 'non-interactive login is not supported for this provider'
    }
  }

  request(args: RequestArguments): Promise<unknown> {
    return Promise.reject(new AiohaRpcError(4200, 'Method not found'))
  }

  async vote(author: string, permlink: string, weight: number): Promise<SignOperationResult> {
    return await this.signAndBroadcastTx([createVote(this.getUser()!, author, permlink, weight)], KeyTypes.Posting)
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
    return await this.signAndBroadcastTx(
      createComment(pa, pp, this.getUser()!, permlink, title, body, json, options) as Operation[],
      KeyTypes.Posting
    )
  }

  async deleteComment(permlink: string): Promise<SignOperationResult> {
    return await this.signAndBroadcastTx([deleteComment(this.getUser()!, permlink)], KeyTypes.Posting)
  }

  customJSON(keyType: KeyTypes, id: string, json: string, displayTitle?: string | undefined): Promise<SignOperationResult> {
    const requiredAuths = keyType === KeyTypes.Active ? [this.getUser()!] : []
    const requiredPostingAuths = keyType === KeyTypes.Posting ? [this.getUser()!] : []
    return this.signAndBroadcastTx([createCustomJSON(requiredAuths, requiredPostingAuths, id, json)], keyType)
  }

  async transfer(to: string, amount: number, currency: Asset, memo?: string): Promise<SignOperationResult> {
    return await this.signAndBroadcastTx([createXfer(this.getUser()!, to, amount, currency, memo)], KeyTypes.Active)
  }

  async recurrentTransfer(
    to: string,
    amount: number,
    currency: Asset,
    recurrence: number,
    executions: number,
    memo?: string | undefined
  ): Promise<SignOperationResult> {
    return await this.signAndBroadcastTx(
      [createRecurrentXfer(this.getUser()!, to, amount, currency, recurrence, executions, memo)],
      KeyTypes.Active
    )
  }

  async stakeHive(amount: number, to?: string | undefined): Promise<SignOperationResult> {
    return await this.signAndBroadcastTx([createStakeHive(this.getUser()!, to ?? this.getUser()!, amount)], KeyTypes.Active)
  }

  async unstakeHive(amount: number): Promise<SignOperationResult> {
    let op: WithdrawVestingOperation
    try {
      op = await createUnstakeHive(this.getUser()!, amount)
    } catch {
      return {
        success: false,
        errorCode: -32603,
        error: 'Failed to retrieve VESTS from staked HIVE'
      }
    }
    return await this.signAndBroadcastTx([op], KeyTypes.Active)
  }

  async unstakeHiveByVests(vests: number): Promise<SignOperationResult> {
    return await this.signAndBroadcastTx([createUnstakeHiveByVests(this.getUser()!, vests)], KeyTypes.Active)
  }

  async delegateStakedHive(to: string, amount: number): Promise<SignOperationResult> {
    let hpv: number
    try {
      hpv = await hivePerVests(this.api)
    } catch {
      return {
        success: false,
        errorCode: -32603,
        error: 'Failed to retrieve HIVE per VESTS'
      }
    }
    return await this.delegateVests(to, amount / hpv)
  }

  async delegateVests(to: string, amount: number): Promise<SignOperationResult> {
    return await this.signAndBroadcastTx([createDelegateVests(this.getUser()!, to, amount)], KeyTypes.Active)
  }

  async voteWitness(witness: string, approve: boolean): Promise<SignOperationResult> {
    return await this.signAndBroadcastTx([createVoteWitness(this.getUser()!, witness, approve)], KeyTypes.Active)
  }

  async voteProposals(proposals: number[], approve: boolean): Promise<SignOperationResult> {
    return await this.signAndBroadcastTx([createVoteProposals(this.getUser()!, proposals, approve)], KeyTypes.Active)
  }

  async setProxy(proxy: string): Promise<SignOperationResult> {
    return await this.signAndBroadcastTx([createSetProxy(this.getUser()!, proxy)], KeyTypes.Active)
  }

  async addAccountAuthority(username: string, role: KeyTypes, weight: number): Promise<SignOperationResult> {
    if (this.getUser()! === username)
      return {
        success: false,
        errorCode: 5201,
        error: 'cannot add itself as account auth'
      }
    return await this.addAuth('account', username, role, weight)
  }

  async removeAccountAuthority(username: string, role: KeyTypes): Promise<SignOperationResult> {
    if (this.getUser()! === username)
      return {
        success: false,
        errorCode: 5201,
        error: 'cannot remove itself as account auth'
      }
    return await this.removeAuth('account', username, role)
  }

  addKeyAuthority(publicKey: string, role: KeyTypes, weight: number): Promise<SignOperationResult> {
    return this.addAuth('key', publicKey, role, weight)
  }

  removeKeyAuthority(publicKey: string, role: KeyTypes): Promise<SignOperationResult> {
    return this.removeAuth('key', publicKey, role)
  }

  async addAuth(type: 'account' | 'key', theAuth: string, role: KeyTypes, weight: number): Promise<SignOperationResult> {
    if (role === KeyTypes.Memo)
      return {
        success: false,
        errorCode: 5005,
        error: `cannot add ${type} memo auth`
      }
    else if (weight <= 0)
      return {
        success: false,
        errorCode: -32003,
        error: 'weight must be greater than 0'
      }
    try {
      const acc = await getAccounts([this.getUser()!], this.api)
      if (getAccountsErrored(acc))
        return {
          success: false,
          errorCode: -32603,
          error: `Failed to fetch current ${type} auths`
        }
      const currentAuths = acc.result[0][role]
      const authExists = currentAuths[`${type}_auths`].findIndex((a: [string, number]) => a[0] === theAuth)
      if (authExists > -1) {
        // update weight if key auth already exists
        if (currentAuths[`${type}_auths`][authExists][1] !== weight) {
          currentAuths[`${type}_auths`][authExists][1] = weight
        } else
          return {
            success: false,
            errorCode: 5200,
            error: 'Nothing to update'
          }
      } else {
        // push new auth if not exist
        currentAuths[`${type}_auths`].push([theAuth, weight])
        currentAuths[`${type}_auths`].sort((a: [string, number], b: [string, number]) => a[0].localeCompare(b[0]))
      }
      return await this.signAndBroadcastTx(
        [
          [
            'account_update',
            {
              account: this.getUser()!,
              posting: acc.result[0].posting as AuthorityType,
              active: acc.result[0].active as AuthorityType,
              memo_key: acc.result[0].memo_key,
              json_metadata: acc.result[0].json_metadata
            }
          ]
        ],
        KeyTypes.Active
      )
    } catch {
      return {
        success: false,
        errorCode: 5000,
        error: 'Failed to add key auth due to unknown error'
      }
    }
  }

  async removeAuth(type: 'account' | 'key', theAuth: string, role: KeyTypes): Promise<SignOperationResult> {
    if (role === KeyTypes.Memo)
      return {
        success: false,
        errorCode: 5005,
        error: `cannot remove ${type} memo auth`
      }
    try {
      const acc = await getAccounts([this.getUser()!], this.api)
      if (getAccountsErrored(acc))
        return {
          success: false,
          errorCode: -32603,
          error: `Failed to fetch current ${type} auths`
        }
      const currentAuths = acc.result[0][role]
      const authExists = currentAuths[`${type}_auths`].findIndex((a: [string, number]) => a[0] === theAuth)
      if (authExists > -1) {
        currentAuths[`${type}_auths`].splice(authExists, 1)
      } else {
        return {
          success: false,
          errorCode: 5200,
          error: 'Nothing to remove'
        }
      }
      return await this.signAndBroadcastTx(
        [
          [
            'account_update',
            {
              account: this.getUser()!,
              posting: acc.result[0].posting as AuthorityType,
              active: acc.result[0].active as AuthorityType,
              memo_key: acc.result[0].memo_key,
              json_metadata: acc.result[0].json_metadata
            }
          ]
        ],
        KeyTypes.Active
      )
    } catch {
      return {
        success: false,
        errorCode: 5000,
        error: `Failed to remove ${type} auth due to unknown error`
      }
    }
  }
}

export interface AiohaOperations {
  // memo
  decryptMemo(memo: string, keyType: KeyTypes): Promise<OperationResult>

  // sign message
  signMessage(message: string, keyType: KeyTypes): Promise<OperationResult>

  // sign and optionally broadcast generic transaction
  signTx(tx: Transaction, keyType: KeyTypes): Promise<SignOperationResult>
  signAndBroadcastTx(tx: Operation[], keyType: KeyTypes): Promise<SignOperationResult>

  // posting auth operation helpers
  vote(author: string, permlink: string, weight: number): Promise<SignOperationResult>
  comment(
    pa: string | null,
    pp: string | null,
    permlink: string,
    title: string,
    body: string,
    json: string,
    options?: CommentOptionsOperation[1]
  ): Promise<SignOperationResult>
  deleteComment(permlink: string): Promise<SignOperationResult>
  customJSON(keyType: KeyTypes, id: string, json: string, displayTitle?: string): Promise<SignOperationResult>

  // active auth operation helpers
  // mostly just constructs the op and calls signAndBroadcastTx(), but some providers
  // such as keychain have its own API method which will show differently in the popup.
  transfer(to: string, amount: number, currency: Asset, memo?: string): Promise<SignOperationResult>
  recurrentTransfer(
    to: string,
    amount: number,
    currency: Asset,
    recurrence: number,
    executions: number,
    memo?: string
  ): Promise<SignOperationResult>
  stakeHive(amount: number, to?: string): Promise<SignOperationResult>
  unstakeHive(amount: number): Promise<SignOperationResult>
  unstakeHiveByVests(vests: number): Promise<SignOperationResult>
  delegateStakedHive(to: string, amount: number): Promise<SignOperationResult>
  delegateVests(to: string, amount: number): Promise<SignOperationResult>
  voteWitness(witness: string, approve: boolean): Promise<SignOperationResult>
  voteProposals(proposals: number[], approve: boolean): Promise<SignOperationResult>
  setProxy(proxy: string): Promise<SignOperationResult>
  addAccountAuthority(username: string, role: KeyTypes, weight: number): Promise<SignOperationResult>
  removeAccountAuthority(username: string, role: KeyTypes): Promise<SignOperationResult>
  addKeyAuthority(publicKey: string, role: KeyTypes, weight: number): Promise<SignOperationResult>
  removeKeyAuthority(publicKey: string, role: KeyTypes): Promise<SignOperationResult>
}
