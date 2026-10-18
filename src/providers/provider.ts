import type { AuthorityType } from '@aioha/types/dist/hive/common.js'
import type {
  CommentOptionsOperation,
  LegacyOperation,
  LegacyTransaction,
  WithdrawVestingOperation
} from '@aioha/types/dist/hive/legacy.js'
import {
  AccountDiscStream,
  Asset,
  DiscoverOptions,
  KeyTypes,
  LoginOptions,
  LoginOptionsNI,
  LoginResult,
  OperationResult,
  OperationResultObj,
  PersistentLogin,
  SignOperationResult,
  SignOperationResultObj,
  SignOperationResultObjHF26,
  VscFer,
  VscStakeType,
  VscTxIntent
} from '../types.js'
import { createVote, createComment, createUnstakeHive, createUnstakeHiveByVests } from '../opbuilder.js'
import { AiohaClient, hivePerVests, getAccounts, getAccountsErrored } from '../rpc.js'
import { RequestArguments, AiohaRpcError } from '../jsonrpc/eip1193-types.js'
import { SimpleEventEmitter } from '../lib/event-emitter.js'
import type { HF26Operation, HF26Transaction } from '@aioha/types/dist/hive/hf26.js'
import { error } from '../lib/errors.js'

const HF26_UNSUPPORTED_ERR = error(4200, 'HF26 serialized tx signing is not supported for this provider')

export abstract class AiohaProviderBase implements AiohaOperations {
  /**
   * @deprecated Superseded by AiohaClient
   */
  protected api: string = ''

  protected rpc: AiohaClient
  protected eventEmitter: SimpleEventEmitter

  constructor(rpc: AiohaClient | string, emitter?: SimpleEventEmitter) {
    this.rpc = typeof rpc === 'string' ? new AiohaClient(rpc) : rpc
    this.eventEmitter = emitter || new SimpleEventEmitter()
  }

  /**
   * This is a hook that is called every time aioha.setApi() is called.
   */
  setApi(api: string, fallbackApis?: string[]) {}

  /**
   * This is a hook that is called every time aioha.setChainId() is called.
   * @param chainId New chain ID
   */
  setChainId(chainId: string) {}

  setEventEmitter(emitter: SimpleEventEmitter) {
    this.eventEmitter = emitter
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
  abstract signTx(tx: LegacyTransaction, keyType: KeyTypes): Promise<SignOperationResultObj>
  abstract signAndBroadcastTx(tx: LegacyOperation[], keyType: KeyTypes): Promise<SignOperationResult>

  async signTxHF26(tx: HF26Transaction, keyType: KeyTypes): Promise<SignOperationResultObjHF26> {
    return HF26_UNSUPPORTED_ERR
  }

  async signAndBroadcastTxHF26(tx: HF26Operation[], keyType: KeyTypes): Promise<SignOperationResult> {
    return HF26_UNSUPPORTED_ERR
  }

  loginNonInteractive(username: string, options: LoginOptionsNI): LoginResult {
    return error(4200, 'non-interactive login is not supported for this provider')
  }

  async discoverAccounts(_?: AccountDiscStream, _2?: DiscoverOptions): Promise<OperationResultObj> {
    return error(4200, 'account discovery is not supported for this provider')
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
      createComment(pa, pp, this.getUser()!, permlink, title, body, json, options) as LegacyOperation[],
      KeyTypes.Posting
    )
  }

  async deleteComment(permlink: string): Promise<SignOperationResult> {
    return await this.signAndBroadcastTx([['delete_comment', { author: this.getUser()!, permlink }]], KeyTypes.Posting)
  }

  customJSON(keyType: KeyTypes, id: string, json: string, displayTitle?: string | undefined): Promise<SignOperationResult> {
    const required_auths = keyType === KeyTypes.Active ? [this.getUser()!] : []
    const required_posting_auths = keyType === KeyTypes.Posting ? [this.getUser()!] : []
    return this.signAndBroadcastTx([['custom_json', { required_auths, required_posting_auths, id, json }]], keyType)
  }

  async transfer(to: string, amount: number, currency: Asset, memo?: string): Promise<SignOperationResult> {
    return await this.signAndBroadcastTx(
      [['transfer', { from: this.getUser()!, to, amount: amount.toFixed(3) + ' ' + currency, memo: memo ?? '' }]],
      KeyTypes.Active
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
    return await this.signAndBroadcastTx(
      [
        [
          'recurrent_transfer',
          {
            from: this.getUser()!,
            to,
            amount: amount.toFixed(3) + ' ' + currency,
            recurrence,
            executions,
            memo: memo ?? '',
            extensions: typeof pair_id === 'number' ? [[1, { pair_id }]] : []
          }
        ]
      ],
      KeyTypes.Active
    )
  }

  async stakeHive(amount: number, to?: string | undefined): Promise<SignOperationResult> {
    return await this.signAndBroadcastTx(
      [['transfer_to_vesting', { from: this.getUser()!, to: to ?? this.getUser()!, amount: amount.toFixed(3) + ' HIVE' }]],
      KeyTypes.Active
    )
  }

  async unstakeHive(amount: number): Promise<SignOperationResult> {
    let op: WithdrawVestingOperation
    try {
      op = await createUnstakeHive(this.getUser()!, amount)
    } catch {
      return error(-32603, 'Failed to retrieve VESTS from staked HIVE')
    }
    return await this.signAndBroadcastTx([op], KeyTypes.Active)
  }

  async unstakeHiveByVests(vests: number): Promise<SignOperationResult> {
    return await this.signAndBroadcastTx([createUnstakeHiveByVests(this.getUser()!, vests)], KeyTypes.Active)
  }

  async delegateStakedHive(to: string, amount: number): Promise<SignOperationResult> {
    let hpv: number
    try {
      hpv = await hivePerVests(this.rpc.api, [...this.rpc.fallbackApis])
    } catch {
      return error(-32603, 'Failed to retrieve HIVE per VESTS')
    }
    return await this.delegateVests(to, amount / hpv)
  }

  async delegateVests(to: string, amount: number): Promise<SignOperationResult> {
    return await this.signAndBroadcastTx(
      [['delegate_vesting_shares', { delegator: this.getUser()!, delegatee: to, vesting_shares: amount.toFixed(6) + ' VESTS' }]],
      KeyTypes.Active
    )
  }

  async voteWitness(witness: string, approve: boolean): Promise<SignOperationResult> {
    return await this.signAndBroadcastTx(
      [['account_witness_vote', { account: this.getUser()!, witness, approve }]],
      KeyTypes.Active
    )
  }

  async voteProposals(proposals: number[], approve: boolean): Promise<SignOperationResult> {
    return await this.signAndBroadcastTx(
      [['update_proposal_votes', { voter: this.getUser()!, proposal_ids: proposals, approve, extensions: [] }]],
      KeyTypes.Active
    )
  }

  async setProxy(proxy: string): Promise<SignOperationResult> {
    return await this.signAndBroadcastTx([['account_witness_proxy', { account: this.getUser()!, proxy }]], KeyTypes.Active)
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
    if (role === KeyTypes.Memo) return error(5005, `cannot ${action} ${type} memo auth`)
    else if (action === 'add' && weight <= 0) return error(-32003, 'weight must be greater than 0')
    else if (type === 'account' && this.getUser()! === theAuth) return error(5201, `cannot ${action} itself as account auth`)
    try {
      const acc = await getAccounts([this.getUser()!], this.rpc.api, [...this.rpc.fallbackApis])
      if (getAccountsErrored(acc)) return error(-32603, `Failed to fetch current ${type} auths`)
      const currentAuths = acc.result[0][role]
      const authExists = currentAuths[`${type}_auths`].findIndex((a: [string, number]) => a[0] === theAuth)
      if (action === 'add') {
        if (authExists > -1) {
          // update weight if key auth already exists
          if (currentAuths[`${type}_auths`][authExists][1] !== weight) {
            currentAuths[`${type}_auths`][authExists][1] = weight
          } else return error(5200, 'Nothing to update')
        } else {
          // push new auth if not exist
          currentAuths[`${type}_auths`].push([theAuth, weight])
          currentAuths[`${type}_auths`].sort((a: [string, number], b: [string, number]) => a[0].localeCompare(b[0]))
        }
      } else if (action === 'remove') {
        if (authExists > -1) {
          currentAuths[`${type}_auths`].splice(authExists, 1)
        } else {
          return error(5200, 'Nothing to remove')
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
      return error(5000, `Failed to ${action} ${type} auth due to unknown error`)
    }
  }

  protected emitSignTx() {
    this.eventEmitter.emit('sign_tx_request')
  }

  protected emitMemoReq() {
    this.eventEmitter.emit('memo_request')
  }

  protected emitLoginReq() {
    this.eventEmitter.emit('login_request')
  }

  protected rmItems(itms: string[]) {
    for (let i in itms) localStorage.removeItem(itms[i])
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
  signTx(tx: LegacyTransaction, keyType: KeyTypes): Promise<SignOperationResultObj>
  signAndBroadcastTx(tx: LegacyOperation[], keyType: KeyTypes): Promise<SignOperationResult>

  // HF26 serialized transactions
  signTxHF26(tx: HF26Transaction, keyType: KeyTypes): Promise<SignOperationResultObjHF26>
  signAndBroadcastTxHF26(tx: HF26Operation[], keyType: KeyTypes): Promise<SignOperationResult>

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
    memo?: string,
    pair_id?: number
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
