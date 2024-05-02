import { CommentOptionsOperation, Operation, Transaction, VoteOperation } from '@hiveio/dhive'
import { HiveAuth } from './providers/hiveauth.js'
import { HiveSigner } from './providers/hivesigner.js'
import { Keychain } from './providers/keychain.js'
import { ClientConfig as HiveSignerOptions } from 'hivesigner/lib/types/client-config.interface.js'
import {
  Asset,
  KeyTypes,
  LoginOptions,
  LoginResult,
  OperationResult,
  SignOperationResult,
  Providers,
  VoteParams
} from './types.js'
import { AppMetaType } from './lib/hiveauth-wrapper.js'
import { createVote } from './opbuilder.js'
import { getAccounts, getDgp } from './rpc.js'
import { AiohaOperations } from './providers/provider.js'

const notLoggedInResult: OperationResult = {
  success: false,
  error: 'Not logged in'
}

export class Aioha implements AiohaOperations {
  providers: {
    keychain?: Keychain
    hivesigner?: HiveSigner
    hiveauth?: HiveAuth
  }
  user?: string
  currentProvider?: Providers
  private vscNetId = 'testnet/0bf2e474-6b9e-4165-ad4e-a0d78968d20c'

  constructor() {
    this.providers = {}
  }

  registerKeychain() {
    this.providers.keychain = new Keychain()
  }

  registerHiveSigner(options: HiveSignerOptions) {
    this.providers.hivesigner = new HiveSigner(options)
  }

  registerHiveAuth(options: AppMetaType) {
    this.providers.hiveauth = new HiveAuth(options)
  }

  /**
   * Get list of registered providers
   * @returns string[]
   */
  getProviders() {
    return Object.keys(this.providers)
  }

  getCurrentProvider() {
    return this.currentProvider
  }

  getCurrentUser() {
    return this.user
  }

  isLoggedIn(): boolean {
    return !!this.user && !!this.currentProvider
  }

  async login(provider: Providers, username: string, options: LoginOptions): Promise<LoginResult> {
    if (!this.providers[provider])
      return {
        success: false,
        error: provider + ' provider is not registered'
      }
    if (provider !== 'hivesigner' && !username)
      return {
        success: false,
        error: 'username is required'
      }
    if (typeof options !== 'object')
      return {
        success: false,
        error: 'options are required'
      }
    const result = await this.providers[provider]!.login(username, options)
    this.user = result.username ?? username
    this.currentProvider = provider
    localStorage.setItem('aiohaUsername', this.user)
    localStorage.setItem('aiohaProvider', this.currentProvider)
    return result
  }

  async logout(): Promise<void> {
    if (!this.user || !this.currentProvider) throw new Error('Not logged in')
    await this.providers[this.currentProvider]!.logout()
    delete this.user
    delete this.currentProvider
    localStorage.removeItem('aiohaUsername')
    localStorage.removeItem('aiohaProvider')
  }

  loadAuth(): boolean {
    const user = localStorage.getItem('aiohaUsername')
    const provider = localStorage.getItem('aiohaProvider') as Providers | null
    if (!provider || !user || !this.providers[provider] || !this.providers[provider]!.loadAuth(user)) return false
    this.user = user
    this.currentProvider = provider
    return true
  }

  async decryptMemo(memo: string, keyType: KeyTypes): Promise<OperationResult> {
    if (!this.isLoggedIn()) return notLoggedInResult
    return await this.providers[this.getCurrentProvider()!]!.decryptMemo(memo, keyType)
  }

  async signMessage(message: string, keyType: KeyTypes): Promise<OperationResult> {
    if (!this.isLoggedIn()) return notLoggedInResult
    return await this.providers[this.getCurrentProvider()!]!.signMessage(message, keyType)
  }

  async signTx(tx: Transaction, keyType: KeyTypes): Promise<OperationResult> {
    if (!this.isLoggedIn()) return notLoggedInResult
    return await this.providers[this.getCurrentProvider()!]!.signTx(tx, keyType)
  }

  async signAndBroadcastTx(tx: Operation[], keyType: KeyTypes): Promise<OperationResult> {
    if (!this.isLoggedIn()) return notLoggedInResult
    return await this.providers[this.getCurrentProvider()!]!.signAndBroadcastTx(tx, keyType)
  }

  async vote(author: string, permlink: string, weight: number): Promise<SignOperationResult> {
    if (!this.isLoggedIn()) return notLoggedInResult
    return await this.providers[this.getCurrentProvider()!]!.vote(author, permlink, weight)
  }

  async voteMany(votes: VoteParams[]): Promise<SignOperationResult> {
    if (!this.isLoggedIn()) return notLoggedInResult
    const voteOps: VoteOperation[] = []
    for (let i in votes) {
      voteOps.push(createVote(this.getCurrentUser()!, votes[i].author, votes[i].permlink, votes[i].weight))
    }
    return await this.signAndBroadcastTx(voteOps, 'posting')
  }

  async comment(
    pa: string | null,
    pp: string | null,
    permlink: string,
    title: string,
    body: string,
    json: string | object,
    options?: CommentOptionsOperation[1]
  ): Promise<SignOperationResult> {
    if (!this.isLoggedIn()) return notLoggedInResult
    if (typeof json === 'object') json = JSON.stringify(json)
    return await this.providers[this.getCurrentProvider()!]!.comment(pa, pp, permlink, title, body, json, options)
  }

  async deleteComment(permlink: string): Promise<SignOperationResult> {
    if (!this.isLoggedIn()) return notLoggedInResult
    return await this.providers[this.getCurrentProvider()!]!.deleteComment(permlink)
  }

  async customJSON(keyType: KeyTypes, id: string, json: string | object, displayTitle?: string): Promise<SignOperationResult> {
    if (!this.isLoggedIn()) return notLoggedInResult
    if (typeof json === 'object') json = JSON.stringify(json)
    return await this.providers[this.getCurrentProvider()!]!.customJSON(keyType, id, json, displayTitle)
  }

  reblog(author: string, permlink: string, removeReblog: boolean): Promise<SignOperationResult> {
    return this.customJSON(
      'posting',
      'reblog',
      [
        'reblog',
        {
          account: this.getCurrentUser()!,
          author,
          permlink,
          delete: removeReblog ? 'delete' : undefined
        }
      ],
      removeReblog ? 'Remove reblog' : 'Reblog'
    )
  }

  follow(target: string, unfollow: boolean): Promise<SignOperationResult> {
    return this.customJSON(
      'posting',
      'follow',
      [
        'follow',
        {
          follower: this.getCurrentUser()!,
          following: target,
          what: unfollow ? [] : ['blog']
        }
      ],
      unfollow ? 'Unfollow' : 'Follow'
    )
  }

  ignore(target: string): Promise<SignOperationResult> {
    return this.customJSON(
      'posting',
      'follow',
      [
        'follow',
        {
          follower: this.getCurrentUser()!,
          following: target,
          what: ['ignore']
        }
      ],
      'Ignore'
    )
  }

  async claimRewards(api: string = 'https://techcoderx.com'): Promise<SignOperationResult> {
    if (!this.isLoggedIn()) return notLoggedInResult
    const accResp = await getAccounts([this.getCurrentUser()!], api)
    if (accResp.error || !Array.isArray(accResp.result) || accResp.result.length === 0)
      return {
        success: false,
        error: 'Failed to fetch pending account rewards'
      }
    else if (
      accResp.result[0].reward_hive_balance === '0.000 HIVE' &&
      accResp.result[0].reward_hbd_balance === '0.000 HBD' &&
      accResp.result[0].reward_vesting_balance === '0.000000 VESTS'
    )
      return {
        success: false,
        error: 'There are no pending rewards to claim'
      }
    return await this.signAndBroadcastTx(
      [
        [
          'claim_reward_balance',
          {
            account: this.getCurrentUser(),
            reward_hive: accResp.result[0].reward_hive_balance,
            reward_hbd: accResp.result[0].reward_hbd_balance,
            reward_vests: accResp.result[0].reward_vesting_balance
          }
        ]
      ],
      'posting'
    )
  }

  async transfer(to: string, amount: number, currency: Asset, memo?: string): Promise<SignOperationResult> {
    if (!this.isLoggedIn()) return notLoggedInResult
    return await this.providers[this.getCurrentProvider()!]!.transfer(to, amount, currency, memo)
  }

  async recurrentTransfer(
    to: string,
    amount: number,
    currency: Asset,
    recurrence: number,
    executions: number,
    memo?: string
  ): Promise<SignOperationResult> {
    if (!this.isLoggedIn()) return notLoggedInResult
    if (recurrence < 24)
      return {
        success: false,
        error: 'recurrence must be at least 24 hours'
      }
    return await this.providers[this.getCurrentProvider()!]!.recurrentTransfer(to, amount, currency, recurrence, executions, memo)
  }

  cancelRecurrentTransfer(to: string, currency: Asset, memo?: string): Promise<SignOperationResult> {
    return this.recurrentTransfer(to, 0, currency, 24, 2, memo)
  }

  async stakeHive(amount: number, to?: string): Promise<SignOperationResult> {
    if (!this.isLoggedIn()) return notLoggedInResult
    return await this.providers[this.getCurrentProvider()!]!.stakeHive(amount, to)
  }

  async unstakeHive(amount: number): Promise<SignOperationResult> {
    if (!this.isLoggedIn()) return notLoggedInResult
    return await this.providers[this.getCurrentProvider()!]!.unstakeHive(amount)
  }

  async unstakeHiveByVests(vests: number): Promise<SignOperationResult> {
    if (!this.isLoggedIn()) return notLoggedInResult
    return await this.providers[this.getCurrentProvider()!]!.unstakeHiveByVests(vests)
  }

  async delegateStakedHive(to: string, amount: number): Promise<SignOperationResult> {
    if (!this.isLoggedIn()) return notLoggedInResult
    return await this.providers[this.getCurrentProvider()!]!.delegateStakedHive(to, amount)
  }

  async delegateVests(to: string, amount: number): Promise<SignOperationResult> {
    if (!this.isLoggedIn()) return notLoggedInResult
    return await this.providers[this.getCurrentProvider()!]!.delegateVests(to, amount)
  }

  async voteWitness(witness: string, approve: boolean): Promise<SignOperationResult> {
    if (!this.isLoggedIn()) return notLoggedInResult
    return await this.providers[this.getCurrentProvider()!]!.voteWitness(witness, approve)
  }

  async voteProposals(proposals: number[], approve: boolean): Promise<SignOperationResult> {
    if (!this.isLoggedIn()) return notLoggedInResult
    return await this.providers[this.getCurrentProvider()!]!.voteProposals(proposals, approve)
  }

  async setProxy(proxy: string): Promise<SignOperationResult> {
    if (!this.isLoggedIn()) return notLoggedInResult
    return await this.providers[this.getCurrentProvider()!]!.setProxy(proxy)
  }

  async clearProxy(): Promise<SignOperationResult> {
    return await this.setProxy('')
  }

  vscSetNetId(net_id: string) {
    this.vscNetId = net_id
  }

  async vscCallContract(
    contractId: string,
    action: string,
    payload: any,
    keyType: KeyTypes = 'posting'
  ): Promise<SignOperationResult> {
    return await this.customJSON(keyType, 'vsc.tx', {
      __v: '0.1',
      __t: 'vsc-tx',
      net_id: this.vscNetId,
      tx: {
        op: 'call_contract',
        action: action,
        contract_id: contractId,
        payload: payload
      }
    })
  }
}

const getPrefix = (head_block_id: string) => {
  // Buffer.from(props.head_block_id, 'hex').readUInt32LE(4)
  const buffer = new Uint8Array(head_block_id.match(/[\da-f]{2}/gi)!.map((h) => parseInt(h, 16)))
  const dataView = new DataView(buffer.buffer)
  const result = dataView.getUint32(4, true) // true for little endian
  return result
}

export const constructTxHeader = async (ops: any[], api: string = 'https://techcoderx.com', expiry: number = 600000) => {
  const propsResp = await getDgp(api)
  if (propsResp.error) throw new Error(propsResp.error)
  const props = propsResp.result
  // TODO: fix tx expiration errors
  return {
    ref_block_num: props.head_block_number & 0xffff,
    ref_block_prefix: getPrefix(props.head_block_id),
    expiration: new Date(new Date(props.time + 'Z').getTime() + expiry).toISOString().slice(0, -5),
    operations: ops,
    extensions: []
  }
}
