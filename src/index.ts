import { CommentOptionsOperation, Operation, Transaction, VoteOperation } from '@hiveio/dhive'
import { HiveAuth } from './providers/hiveauth.js'
import { HiveSigner } from './providers/hivesigner.js'
import { Keychain } from './providers/keychain.js'
import { ClientConfig as HiveSignerOptions } from 'hivesigner/lib/types/client-config.interface.js'
import { KeyTypes, LoginOptions, LoginResult, OperationResult, SignOperationResult, Providers, VoteParams } from './types.js'
import { AppMetaType } from './lib/hiveauth-wrapper.js'
import { createVote } from './opbuilder.js'

const notLoggedInResult: OperationResult = {
  success: false,
  error: 'Not logged in'
}

export class Aioha {
  providers: {
    keychain?: Keychain
    hivesigner?: HiveSigner
    hiveauth?: HiveAuth
  }
  user?: string
  currentProvider?: Providers

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

  async customJSON(
    required_auths: string[],
    required_posting_auths: string[],
    id: string,
    json: string | object,
    displayTitle?: string
  ): Promise<SignOperationResult> {
    if (!this.isLoggedIn()) return notLoggedInResult
    if (typeof json === 'object') json = JSON.stringify(json)
    return await this.providers[this.getCurrentProvider()!]!.customJSON(
      required_auths,
      required_posting_auths,
      id,
      json,
      displayTitle
    )
  }

  reblog(author: string, permlink: string, removeReblog: boolean): Promise<SignOperationResult> {
    return this.customJSON(
      [],
      [this.getCurrentUser()!],
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
      [],
      [this.getCurrentUser()!],
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
      [],
      [this.getCurrentUser()!],
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
}

const getPrefix = (head_block_id: string) => {
  // Buffer.from(props.head_block_id, 'hex').readUInt32LE(4)
  const buffer = new Uint8Array(head_block_id.match(/[\da-f]{2}/gi)!.map((h) => parseInt(h, 16)))
  const dataView = new DataView(buffer.buffer)
  const result = dataView.getUint32(4, true) // true for little endian
  return result
}

export const constructTxHeader = async (ops: any[], api: string = 'https://techcoderx.com', expiry: number = 600000) => {
  const propsReq = await fetch(api, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'database_api.get_dynamic_global_properties',
      params: {}
    })
  })
  const propsResp = await propsReq.json()
  if (propsResp.error) throw new Error(propsResp)
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
