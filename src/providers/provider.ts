import { AuthorityType, CommentOptionsOperation, Operation, Transaction, WithdrawVestingOperation } from '@hiveio/dhive'
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
import { HF26Operation, HF26Transaction } from '../lib/hf26-types.js'
import { error } from '../lib/errors.js'

export const DEFAULT_VSC_NET_ID = 'vsc-mainnet'

const HF26_UNSUPPORTED_ERR = error(4200, 'HF26 serialized tx signing is not supported for this provider')

export abstract class AiohaProviderBase implements AiohaOperations {
  protected api: string
  protected eventEmitter: SimpleEventEmitter

  constructor(api: string, emitter?: SimpleEventEmitter) {
    this.api = api
    this.eventEmitter = emitter || new SimpleEventEmitter()
  }

  setApi(api: string) {
    this.api = api
  }

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
  abstract signTx(tx: Transaction, keyType: KeyTypes): Promise<SignOperationResultObj>
  abstract signAndBroadcastTx(tx: Operation[], keyType: KeyTypes): Promise<SignOperationResult>

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
      hpv = await hivePerVests(this.api)
    } catch {
      return error(-32603, 'Failed to retrieve HIVE per VESTS')
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
    if (role === KeyTypes.Memo) return error(5005, `cannot ${action} ${type} memo auth`)
    else if (action === 'add' && weight <= 0) return error(-32003, 'weight must be greater than 0')
    else if (type === 'account' && this.getUser()! === theAuth) return error(5201, `cannot ${action} itself as account auth`)
    try {
      const acc = await getAccounts([this.getUser()!], this.api)
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

  async vscCallContract(
    contractId: string,
    action: string,
    payload: any,
    rc_limit: number,
    intents: VscTxIntent[],
    keyType: KeyTypes,
    net_id: string = DEFAULT_VSC_NET_ID
  ): Promise<SignOperationResult> {
    return await this.customJSON(
      keyType,
      'vsc.call',
      JSON.stringify({
        net_id: net_id,
        contract_id: contractId,
        action: action,
        payload: payload,
        rc_limit,
        intents
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

  vscStake(
    stakeType: VscStakeType,
    amount: number,
    to?: string,
    memo?: string,
    net_id: string = DEFAULT_VSC_NET_ID
  ): Promise<SignOperationResult> {
    switch (stakeType) {
      case VscStakeType.Consensus:
        return this.vscFer('consensus_stake', net_id, to ?? this.getUser()!, amount, Asset.HIVE, memo)
      case VscStakeType.HBD:
        return this.vscFer('stake_hbd', net_id, to ?? this.getUser()!, amount, Asset.HBD, memo)
    }
  }

  vscUnstake(
    stakeType: VscStakeType,
    amount: number,
    to?: string,
    memo?: string,
    net_id: string = DEFAULT_VSC_NET_ID
  ): Promise<SignOperationResult> {
    switch (stakeType) {
      case VscStakeType.Consensus:
        return this.vscFer('consensus_unstake', net_id, to ?? this.getUser()!, amount, Asset.HIVE, memo)
      case VscStakeType.HBD:
        return this.vscFer('unstake_hbd', net_id, to ?? this.getUser()!, amount, Asset.HBD, memo)
    }
  }

  async vscFer(
    type: VscFer,
    net_id: string,
    to: string,
    amount: number,
    currency: Asset,
    memo?: string
  ): Promise<SignOperationResult> {
    return await this.customJSON(
      KeyTypes.Active,
      `vsc.${type}`,
      JSON.stringify({
        to: to.startsWith('did:') || to.startsWith('hive:') ? to : `hive:${to}`,
        from: `hive:${this.getUser()}`,
        amount: amount.toFixed(3),
        asset: currency.toLowerCase(),
        memo,
        net_id: net_id
      })
    )
  }

  protected emitSignTx() {
    this.eventEmitter.emit('sign_tx_request')
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
  signTx(tx: Transaction, keyType: KeyTypes): Promise<SignOperationResultObj>
  signAndBroadcastTx(tx: Operation[], keyType: KeyTypes): Promise<SignOperationResult>

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
    rc_limit: number,
    intents: VscTxIntent[],
    keyType: KeyTypes,
    net_id?: string
  ): Promise<SignOperationResult>
  vscTransfer(to: string, amount: number, currency: Asset, memo?: string, net_id?: string): Promise<SignOperationResult>
  vscWithdraw(to: string, amount: number, currency: Asset, memo?: string, net_id?: string): Promise<SignOperationResult>
  vscStake(stakeType: VscStakeType, amount: number, to?: string, memo?: string, net_id?: string): Promise<SignOperationResult>
  vscUnstake(stakeType: VscStakeType, amount: number, to?: string, memo?: string, net_id?: string): Promise<SignOperationResult>
}
