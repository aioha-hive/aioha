import { AuthorityType, CommentOptionsOperation, Operation, Transaction, WithdrawVestingOperation } from '@hiveio/dhive'
import {
  Asset,
  KeyTypes,
  LoginOptions,
  LoginOptionsNI,
  LoginResult,
  OperationResult,
  OperationResultObj,
  PersistentLogin,
  SignOperationResult
} from '../types.js'
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
import { SimpleEventEmitter } from '../lib/event-emitter.js'

export const DEFAULT_VSC_NET_ID = 'testnet/0bf2e474-6b9e-4165-ad4e-a0d78968d20c'

export abstract class AiohaProviderBase implements AiohaOperations {
  protected api: string
  protected eventEmitter: SimpleEventEmitter

  constructor(api: string, emitter: SimpleEventEmitter) {
    this.api = api
    this.eventEmitter = emitter
  }

  setApi(api: string) {
    this.api = api
  }

  abstract login(username: string, options: LoginOptions): Promise<LoginResult>
  abstract loginAndDecryptMemo(username: string, options: LoginOptions): Promise<LoginResult>
  abstract logout(): Promise<void>
  abstract loadAuth(username: string): boolean
  abstract getUser(): string | undefined
  abstract getLoginInfo(): PersistentLogin | undefined
  abstract loadLogin(username: string, info: PersistentLogin): boolean
  abstract encryptMemo(message: string, keyType: KeyTypes, recipient: string): Promise<OperationResult>
  abstract encryptMemoWithKeys(message: string, keyType: KeyTypes, recipientKeys: string[]): Promise<OperationResultObj>
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

  addAccountAuthority(username: string, role: KeyTypes, weight: number): Promise<SignOperationResult> {
    return this.modifyAuth('add', 'account', username, role, weight)
  }

  removeAccountAuthority(username: string, role: KeyTypes): Promise<SignOperationResult> {
    return this.modifyAuth('remove', 'account', username, role, 0)
  }

  addKeyAuthority(publicKey: string, role: KeyTypes, weight: number): Promise<SignOperationResult> {
    return this.modifyAuth('add', 'key', publicKey, role, weight)
  }

  removeKeyAuthority(publicKey: string, role: KeyTypes): Promise<SignOperationResult> {
    return this.modifyAuth('remove', 'key', publicKey, role, 0)
  }

  async modifyAuth(
    action: 'add' | 'remove',
    type: 'account' | 'key',
    theAuth: string,
    role: KeyTypes,
    weight: number
  ): Promise<SignOperationResult> {
    if (role === KeyTypes.Memo)
      return {
        success: false,
        errorCode: 5005,
        error: `cannot ${action} ${type} memo auth`
      }
    else if (action === 'add' && weight <= 0)
      return {
        success: false,
        errorCode: -32003,
        error: 'weight must be greater than 0'
      }
    else if (type === 'account' && this.getUser()! === theAuth)
      return {
        success: false,
        errorCode: 5201,
        error: `cannot ${action} itself as account auth`
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
      if (action === 'add') {
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
      } else if (action === 'remove') {
        if (authExists > -1) {
          currentAuths[`${type}_auths`].splice(authExists, 1)
        } else {
          return {
            success: false,
            errorCode: 5200,
            error: 'Nothing to remove'
          }
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
        error: `Failed to ${action} ${type} auth due to unknown error`
      }
    }
  }

  async vscCallContract(
    contractId: string,
    action: string,
    payload: any,
    keyType: KeyTypes,
    net_id: string = DEFAULT_VSC_NET_ID
  ): Promise<SignOperationResult> {
    return await this.customJSON(
      keyType,
      'vsc.tx',
      JSON.stringify({
        __v: '0.1',
        __t: 'vsc-tx',
        net_id: net_id,
        tx: {
          op: 'call_contract',
          action: action,
          contract_id: contractId,
          payload: payload
        }
      })
    )
  }

  vscTransfer(
    to: string,
    amount: number,
    currency: Asset,
    memo?: string,
    net_id: string = DEFAULT_VSC_NET_ID
  ): Promise<SignOperationResult> {
    return this.vscFer('transfer', net_id, to, amount, currency, memo)
  }

  vscWithdraw(
    to: string,
    amount: number,
    currency: Asset,
    memo?: string,
    net_id: string = DEFAULT_VSC_NET_ID
  ): Promise<SignOperationResult> {
    return this.vscFer('withdraw', net_id, to, amount, currency, memo)
  }

  async vscFer(
    type: 'transfer' | 'withdraw',
    net_id: string,
    to: string,
    amount: number,
    currency: Asset,
    memo?: string
  ): Promise<SignOperationResult> {
    return await this.customJSON(
      KeyTypes.Active,
      'vsc.tx',
      JSON.stringify({
        __v: '0.1',
        __t: 'vsc-tx',
        net_id: net_id,
        tx: {
          op: type,
          payload: {
            tk: currency,
            to: to.startsWith('did:') || to.startsWith('hive:') ? to : `hive:${to}`,
            from: `hive:${this.getUser()}`,
            amount: Math.round(amount * 1000),
            memo
          }
        }
      })
    )
  }
}

export interface AiohaOperations {
  // memo
  encryptMemo(message: string, keyType: KeyTypes, recipient: string): Promise<OperationResult>
  encryptMemoWithKeys(message: string, keyType: KeyTypes, recipientKeys: string[]): Promise<OperationResultObj>
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

  // vsc operations
  vscCallContract(
    contractId: string,
    action: string,
    payload: any,
    keyType: KeyTypes,
    net_id?: string
  ): Promise<SignOperationResult>
  vscTransfer(to: string, amount: number, currency: Asset, memo?: string, net_id?: string): Promise<SignOperationResult>
  vscWithdraw(to: string, amount: number, currency: Asset, memo?: string, net_id?: string): Promise<SignOperationResult>
}
