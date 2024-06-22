import { CommentOptionsOperation, Operation, Transaction, VoteOperation } from '@hiveio/dhive'
import { HiveAuth } from './providers/hiveauth.js'
import { HiveSigner } from './providers/hivesigner.js'
import { Keychain } from './providers/keychain.js'
import { Ledger } from './providers/ledger.js'
import { PeakVault } from './providers/peakvault.js'
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
import { DEFAULT_API, getAccounts } from './rpc.js'
import { AiohaOperations } from './providers/provider.js'
export { constructTxHeader } from './opbuilder.js'
export { broadcastTx, call, hivePerVests } from './rpc.js'
export { Asset, KeyTypes, Providers } from './types.js'

const notLoggedInResult: OperationResult = {
  success: false,
  error: 'Not logged in'
}

const noMemoAllowResult: OperationResult = {
  success: false,
  error: 'key type cannot be memo'
}

export class Aioha implements AiohaOperations {
  private providers: {
    keychain?: Keychain
    hivesigner?: HiveSigner
    hiveauth?: HiveAuth
    ledger?: Ledger
    peakvault?: PeakVault
  }
  private user?: string
  private currentProvider?: Providers
  private vscNetId = 'testnet/0bf2e474-6b9e-4165-ad4e-a0d78968d20c'
  private api = DEFAULT_API

  constructor(api?: string) {
    this.providers = {}
    if (api) {
      this.setApi(api)
    }
  }

  /**
   * Register Hive Keychain provider.
   */
  registerKeychain() {
    this.providers.keychain = new Keychain()
  }

  /**
   * Register HiveSigner provider.
   * @param {HiveSignerOptions} options HiveSigner instantiation options. See https://github.com/ecency/hivesigner-sdk#init-client for details.
   */
  registerHiveSigner(options: HiveSignerOptions) {
    this.providers.hivesigner = new HiveSigner(this.api, options)
  }

  /**
   * Register HiveAuth provider.
   * @param {AppMetaType} options HiveAuth app metadata.
   * @param {string} options.name App name
   * @param {string} [options.description] Description of the app
   * @param {string} [options.icon] URL to app icon
   */
  registerHiveAuth(options: AppMetaType) {
    this.providers.hiveauth = new HiveAuth(this.api, options)
  }

  /**
   * Register Ledger provider.
   */
  registerLedger() {
    this.providers.ledger = new Ledger(this.api)
  }

  /**
   * Register Peak Vault provider.
   */
  registerPeakVault() {
    this.providers.peakvault = new PeakVault()
  }

  /**
   * Deregister a provider. Must be logged out or unauthenticated.
   * @param provider Provider to deregister
   * @returns Boolean of whether the provider has been successfully deregistered
   */
  deregisterProvider(provider: Providers) {
    if (!this.providers[provider] || this.isLoggedIn()) return false
    delete this.providers[provider]
    return true
  }

  /**
   * Checks if a provider is registered
   * @param provider A Providers enum value
   * @returns boolean of whether the specified provider is registered
   */
  isProviderRegistered(provider: Providers): boolean {
    return !!this.providers[provider]
  }

  /**
   * Checks if a provider is registered and ready to use (i.e. Keychain provider is registered and browser extension installed by user)
   * @param provider A Providers enum value
   * @returns boolean of whether the specified provider is ready to use by the user
   */
  isProviderEnabled(provider: Providers): boolean {
    switch (provider) {
      case Providers.Keychain:
        return !!this.providers.keychain && Keychain.isInstalled()
      default:
        return !!this.providers[provider]
    }
  }

  /**
   * Get list of registered providers
   * @returns string[]
   */
  getProviders() {
    return Object.keys(this.providers)
  }

  /**
   * Get the current provider of the authenticated Hive account.
   * @returns The current provider
   */
  getCurrentProvider() {
    return this.currentProvider
  }

  /**
   * Get the username of the authenticated Hive account.
   * @returns The current username
   */
  getCurrentUser() {
    return this.user
  }

  /**
   * Returns a boolean value of whether a user is logged in or not.
   * @returns {boolean}
   */
  isLoggedIn(): boolean {
    return !!this.user && !!this.currentProvider
  }

  /**
   * Set Hive API URL used by some providers for API calls.
   * @param api Hive API URL
   */
  setApi(api: string): void {
    if (!api.startsWith('http://') && !api.startsWith('https://')) throw new Error('api must start from http:// or https://')
    this.api = api
    for (const p in this.providers) this.providers[p as Providers]?.setApi(api)
  }

  /**
   * Authenticate a Hive account by requesting a message signature.
   * @param {string} provider The provider to use for auth which must be registered already. Valid values: `keychain`, `hivesigner` and `hiveauth`.
   * @param {string} username Hive username
   * @param {LoginOptions} options Login options including message to sign and provider specific options.
   * @returns The login result.
   */
  async login(provider: Providers, username: string, options: LoginOptions): Promise<LoginResult> {
    if (this.isLoggedIn()) throw new Error('already logged in')
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
    if (result.success) {
      this.user = result.username ?? username
      this.currentProvider = provider
      localStorage.setItem('aiohaUsername', this.user)
      localStorage.setItem('aiohaProvider', this.currentProvider)
    }
    return result
  }

  /**
   * Logout the current authenticated user.
   */
  async logout(): Promise<void> {
    if (!this.user || !this.currentProvider) throw new Error('Not logged in')
    await this.providers[this.currentProvider]!.logout()
    delete this.user
    delete this.currentProvider
    localStorage.removeItem('aiohaUsername')
    localStorage.removeItem('aiohaProvider')
  }

  /**
   * Load persistent login details from local storage.
   * @returns boolean of whether an authentication has been loaded or not.
   */
  loadAuth(): boolean {
    const user = localStorage.getItem('aiohaUsername')
    const provider = localStorage.getItem('aiohaProvider') as Providers | null
    if (!provider || !user || !this.providers[provider] || !this.providers[provider]!.loadAuth(user)) return false
    this.user = user
    this.currentProvider = provider
    return true
  }

  /**
   * Decrypt a memo.
   * @param memo Memo to decrypt. Memos are to be decrypted with `hivesigner` posting key when the current provider is HiveSigner.
   * @param keyType Key type to be used to decrypt the memo. Must be `posting` for HiveSigner provider.
   * @returns Decryption result
   */
  async decryptMemo(memo: string, keyType: KeyTypes): Promise<OperationResult> {
    if (!this.isLoggedIn()) return notLoggedInResult
    return await this.providers[this.getCurrentProvider()!]!.decryptMemo(memo, keyType)
  }

  /**
   * Sign a message.
   * @param message Message to be signed
   * @param keyType Key type to be used to sign the message
   * @returns Message signing result
   */
  async signMessage(message: string, keyType: KeyTypes): Promise<OperationResult> {
    if (!this.isLoggedIn()) return notLoggedInResult
    return await this.providers[this.getCurrentProvider()!]!.signMessage(message, keyType)
  }

  /**
   * Sign a full transaction with headers without broadcasting it.
   * @param tx The full unsigned transaction containing both headers and operation body
   * @param keyType Key type to be used to sign the transaction.
   * @returns Transaction signing result
   */
  async signTx(tx: Transaction, keyType: KeyTypes): Promise<OperationResult> {
    if (!this.isLoggedIn()) return notLoggedInResult
    return await this.providers[this.getCurrentProvider()!]!.signTx(tx, keyType)
  }

  /**
   * Sign and broadcast a transaction.
   * @param tx List of operations for the transaction.
   * @param keyType Key type to be used to sign the transaction.
   * @returns Transaction result
   */
  async signAndBroadcastTx(tx: Operation[], keyType: KeyTypes): Promise<OperationResult> {
    if (!this.isLoggedIn()) return notLoggedInResult
    else if (keyType === 'memo') return noMemoAllowResult
    return await this.providers[this.getCurrentProvider()!]!.signAndBroadcastTx(tx, keyType)
  }

  /**
   * Vote for a post or comment.
   * @param author Author
   * @param permlink Permlink
   * @param weight Vote weight in basis points. Must be between -10000 and 10000.
   * @returns Transaction result
   */
  async vote(author: string, permlink: string, weight: number): Promise<SignOperationResult> {
    if (!this.isLoggedIn()) return notLoggedInResult
    return await this.providers[this.getCurrentProvider()!]!.vote(author, permlink, weight)
  }

  /**
   * Vote multiple posts and/or comments.
   * @param votes Details of each vote including author, permlink and weight.
   * @returns Transaction result
   */
  async voteMany(votes: VoteParams[]): Promise<SignOperationResult> {
    if (!this.isLoggedIn()) return notLoggedInResult
    const voteOps: VoteOperation[] = []
    for (let i in votes) {
      voteOps.push(createVote(this.getCurrentUser()!, votes[i].author, votes[i].permlink, votes[i].weight))
    }
    return await this.signAndBroadcastTx(voteOps, KeyTypes.Posting)
  }

  /**
   * Create a post or comment.
   * @param pa Parent author
   * @param pp Parent permlink
   * @param permlink Permlink
   * @param title Title
   * @param body Body
   * @param json JSON metadata
   * @param options Comment options
   * @returns Transaction result
   */
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

  /**
   * Delete a post or comment. The post or comment must contain no child comments or positive rshares.
   * @param permlink Permlink of the post or comment to delete.
   * @returns Transaction result
   */
  async deleteComment(permlink: string): Promise<SignOperationResult> {
    if (!this.isLoggedIn()) return notLoggedInResult
    return await this.providers[this.getCurrentProvider()!]!.deleteComment(permlink)
  }

  /**
   * Publish an arbitrary JSON data.
   * @param keyType Key type to use
   * @param id ID of the JSON.
   * @param json JSON payload
   * @param displayTitle Title to be displayed on certain providers that support them (i.e. Keychain).
   * @returns Transaction result
   */
  async customJSON(keyType: KeyTypes, id: string, json: string | object, displayTitle?: string): Promise<SignOperationResult> {
    if (!this.isLoggedIn()) return notLoggedInResult
    if (typeof json === 'object') json = JSON.stringify(json)
    else if (keyType === 'memo') return noMemoAllowResult
    return await this.providers[this.getCurrentProvider()!]!.customJSON(keyType, id, json, displayTitle)
  }

  /**
   * Add or remove someone elses post (or your own post that is posted to a Hivemind community) to your blog.
   * @param author Author of post
   * @param permlink Permlink of post
   * @param removeReblog Boolean of whether to remove the post from your blog instead.
   * @returns Transaction result
   */
  reblog(author: string, permlink: string, removeReblog: boolean): Promise<SignOperationResult> {
    return this.customJSON(
      KeyTypes.Posting,
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

  /**
   * Follow or unfollow a user.
   * @param target The username to follow
   * @param unfollow Boolean of whether to unfollow the account instead.
   * @returns Transaction result
   */
  follow(target: string, unfollow: boolean): Promise<SignOperationResult> {
    return this.customJSON(
      KeyTypes.Posting,
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

  /**
   * Ignore a user from your feed.
   * @param target The username to ignore
   * @returns Transaction result
   */
  ignore(target: string): Promise<SignOperationResult> {
    return this.customJSON(
      KeyTypes.Posting,
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

  /**
   * Claim Hive rewards that have paid out from content reward pool.
   * @returns Transaction result
   */
  async claimRewards(): Promise<SignOperationResult> {
    if (!this.isLoggedIn()) return notLoggedInResult
    const accResp = await getAccounts([this.getCurrentUser()!], this.api)
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
      KeyTypes.Posting
    )
  }

  /**
   * Transfer HIVE/HBD to another account.
   * @param to Destination username
   * @param amount Transaction amount
   * @param currency HIVE or HBD
   * @param memo Memo to be attached in the transfer
   * @returns Transaction result
   */
  async transfer(to: string, amount: number, currency: Asset, memo?: string): Promise<SignOperationResult> {
    if (!this.isLoggedIn()) return notLoggedInResult
    return await this.providers[this.getCurrentProvider()!]!.transfer(to, amount, currency, memo)
  }

  /**
   * Recurrent transfer HIVE/HBD to another account.
   * @param to Destination username
   * @param amount Transaction amount
   * @param currency HIVE or HBD
   * @param recurrence Interval in hours between each transfer.
   * @param executions Number of transfers to be made automatically.
   * @param memo Memo to be attached in the transfer
   * @returns Transaction result
   */
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

  /**
   * Cancel an ongoing recurrent transfer.
   * @param to Destination username
   * @param currency HIVE or HBD
   * @param memo Memo to be attached in the cancellation
   * @returns Transaction result
   */
  cancelRecurrentTransfer(to: string, currency: Asset, memo?: string): Promise<SignOperationResult> {
    return this.recurrentTransfer(to, 0, currency, 24, 2, memo)
  }

  /**
   * Stake HIVE.
   * @param amount HIVE to stake.
   * @param to Username to stake HIVE on behalf of. Usually and defaults to own account.
   * @returns Transaction result
   */
  async stakeHive(amount: number, to?: string): Promise<SignOperationResult> {
    if (!this.isLoggedIn()) return notLoggedInResult
    return await this.providers[this.getCurrentProvider()!]!.stakeHive(amount, to)
  }

  /**
   * Unstake HIVE.
   * @param amount HIVE to unstake.
   * @returns Transaction result
   */
  async unstakeHive(amount: number): Promise<SignOperationResult> {
    if (!this.isLoggedIn()) return notLoggedInResult
    return await this.providers[this.getCurrentProvider()!]!.unstakeHive(amount)
  }

  /**
   * Unstake HIVE by vesting shares.
   * @param vests
   * @returns Transaction result
   */
  async unstakeHiveByVests(vests: number): Promise<SignOperationResult> {
    if (!this.isLoggedIn()) return notLoggedInResult
    return await this.providers[this.getCurrentProvider()!]!.unstakeHiveByVests(vests)
  }

  /**
   * Delegate staked HIVE to another account.
   * @param to Delegatee
   * @param amount Staked HIVE to delegate
   * @returns Transaction result
   */
  async delegateStakedHive(to: string, amount: number): Promise<SignOperationResult> {
    if (!this.isLoggedIn()) return notLoggedInResult
    return await this.providers[this.getCurrentProvider()!]!.delegateStakedHive(to, amount)
  }

  /**
   * Delegate staked HIVE to another account by vesting shares.
   * @param to Delegatee
   * @param amount Vesting shares
   * @returns Transaction result
   */
  async delegateVests(to: string, amount: number): Promise<SignOperationResult> {
    if (!this.isLoggedIn()) return notLoggedInResult
    return await this.providers[this.getCurrentProvider()!]!.delegateVests(to, amount)
  }

  /**
   * Vote or unvote for a Hive witness.
   * @param witness Witness username to vote or unvote
   * @param approve Boolean for whether to vote or unvote the witness
   * @returns Transaction result
   */
  async voteWitness(witness: string, approve: boolean): Promise<SignOperationResult> {
    if (!this.isLoggedIn()) return notLoggedInResult
    return await this.providers[this.getCurrentProvider()!]!.voteWitness(witness, approve)
  }

  /**
   * Vote or unvote a list of DHF proposals by proposal IDs.
   * @param {number[]} proposals Array of proposal IDs to vote or unvote proposals
   * @param approve Boolean for whether to vote or unvote the proposals
   * @returns Transaction result
   */
  async voteProposals(proposals: number[], approve: boolean): Promise<SignOperationResult> {
    if (!this.isLoggedIn()) return notLoggedInResult
    return await this.providers[this.getCurrentProvider()!]!.voteProposals(proposals, approve)
  }

  /**
   * Set account proxy for governance voting.
   * @param proxy The proxy account username
   * @returns Transaction result
   */
  async setProxy(proxy: string): Promise<SignOperationResult> {
    if (!this.isLoggedIn()) return notLoggedInResult
    return await this.providers[this.getCurrentProvider()!]!.setProxy(proxy)
  }

  /**
   * Clear account proxy for governance voting.
   * @returns Transaction result
   */
  async clearProxy(): Promise<SignOperationResult> {
    return await this.setProxy('')
  }

  /**
   * Add an account auth.
   * @param username Account username to authorize
   * @param role KeyTypes role to authorize. Must be either KeyTypes.Posting or KeyTypes.Active
   * @param weight Weight of the account auth
   * @returns Transaction result
   */
  async addAccountAuthority(username: string, role: KeyTypes, weight: number): Promise<SignOperationResult> {
    if (!this.isLoggedIn()) return notLoggedInResult
    return await this.providers[this.getCurrentProvider()!]!.addAccountAuthority(username, role, weight)
  }

  /**
   * Remove an account auth.
   * @param username Account username to revoke
   * @param role KeyTypes role to revoke. Must be either KeyTypes.Posting or KeyTypes.Active
   * @returns Transaction result
   */
  async removeAccountAuthority(username: string, role: KeyTypes): Promise<SignOperationResult> {
    if (!this.isLoggedIn()) return notLoggedInResult
    return await this.providers[this.getCurrentProvider()!]!.removeAccountAuthority(username, role)
  }

  /**
   * Add a key auth.
   * @param username Public key to authorize
   * @param role KeyTypes role to authorize. Must be either KeyTypes.Posting or KeyTypes.Active
   * @param weight Weight of the key auth
   * @returns Transaction result
   */
  async addKeyAuthority(publicKey: string, role: KeyTypes, weight: number): Promise<SignOperationResult> {
    if (!this.isLoggedIn()) return notLoggedInResult
    return await this.providers[this.getCurrentProvider()!]!.addKeyAuthority(publicKey, role, weight)
  }

  /**
   * Remove a key auth.
   * @param username Public key to revoke
   * @param role KeyTypes role to revoke. Must be either KeyTypes.Posting or KeyTypes.Active
   * @param weight Weight of the key auth
   * @returns Transaction result
   */
  async removeKeyAuthority(publicKey: string, role: KeyTypes): Promise<SignOperationResult> {
    if (!this.isLoggedIn()) return notLoggedInResult
    return await this.providers[this.getCurrentProvider()!]!.removeKeyAuthority(publicKey, role)
  }

  /**
   * Set the VSC network ID for VSC related functions.
   * @param net_id VSC network ID to use.
   */
  vscSetNetId(net_id: string) {
    this.vscNetId = net_id
  }

  /**
   * Call a VSC contract from L1.
   * @param contractId Contract ID
   * @param action Contract action
   * @param payload Contract call payload
   * @param keyType Key type to authenticate with. Valid values are `posting` and `active`.
   * @returns Transaction result
   */
  async vscCallContract(
    contractId: string,
    action: string,
    payload: any,
    keyType: KeyTypes = KeyTypes.Posting
  ): Promise<SignOperationResult> {
    if (keyType === 'memo') return noMemoAllowResult
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

export const initAioha = (options?: { hivesigner?: HiveSignerOptions; hiveauth?: AppMetaType }): Aioha => {
  if (!options) options = {}
  if (!options.hiveauth)
    options.hiveauth = {
      name: 'Aioha Generic App'
    }

  const aioha = new Aioha()
  aioha.registerKeychain()
  aioha.registerLedger()
  aioha.registerPeakVault()
  aioha.registerHiveAuth(options.hiveauth)
  if (options.hivesigner) aioha.registerHiveSigner(options.hivesigner)
  aioha.loadAuth()

  return aioha
}
