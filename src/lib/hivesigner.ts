import { CallbackFunction, ClientConfig, LoginOptions, SendResponse } from './hivesigner-types.js'
import { Operation } from '@hiveio/dhive'

const API_URL = 'https://hivesigner.com'
const BASE_URL = 'https://hivesigner.com'

const isBrowser = () => typeof window !== 'undefined' && !!window

export class Client {
  public apiURL: string
  public app: string
  public callbackURL: string
  public scope?: string[]
  public responseType?: string
  public accessToken?: string

  constructor(config: ClientConfig) {
    this.apiURL = config.apiURL || API_URL
    this.app = config.app
    this.callbackURL = config.callbackURL
    this.accessToken = config.accessToken
    this.scope = config.scope
    this.responseType = config.responseType
  }

  public setApiURL(url: string): this {
    this.apiURL = url
    return this
  }

  public setApp(app: string): this {
    this.app = app
    return this
  }

  public setCallbackURL(url: string): this {
    this.callbackURL = url
    return this
  }

  public setAccessToken(accessToken: string): this {
    this.accessToken = accessToken
    return this
  }

  public removeAccessToken(): this {
    delete this.accessToken
    return this
  }

  public setScope(scope: string[]): this {
    this.scope = scope
    return this
  }

  public getLoginURL(state: string, account?: string): string {
    const redirectUri = encodeURIComponent(this.callbackURL)
    let loginURL = `${BASE_URL}/oauth2/authorize?client_id=${this.app}&redirect_uri=${redirectUri}`
    if (this.responseType === 'code') {
      loginURL += `&response_type=${this.responseType}`
    }
    if (this.scope) {
      loginURL += `&scope=${this.scope.join(',')}`
    }
    if (state) {
      loginURL += `&state=${encodeURIComponent(state)}`
    }
    if (account) {
      loginURL += `&account=${encodeURIComponent(account)}`
    }
    return loginURL
  }

  public login(options: LoginOptions): void {
    if (isBrowser()) {
      // @ts-ignore
      window.location = this.getLoginURL(options.state)
    }
  }

  public me(cb?: CallbackFunction): Promise<SendResponse> {
    return this.send('me', 'POST', {}, cb)
  }

  public decode(memo: string, cb?: CallbackFunction): Promise<SendResponse> {
    return this.send('decode', 'POST', { memo: memo }, cb)
  }

  public vote(
    voter: string,
    author: string,
    permlink: string,
    weight: string | number,
    cb?: CallbackFunction
  ): Promise<SendResponse> {
    const params = {
      voter,
      author,
      permlink,
      weight
    }
    return this.broadcast([['vote', params]], cb)
  }

  public comment(
    parentAuthor: string,
    parentPermlink: string,
    author: string,
    permlink: string,
    title: string,
    body: any,
    jsonMetadata: any,
    cb?: CallbackFunction
  ): Promise<SendResponse> {
    let json = jsonMetadata
    if (typeof jsonMetadata !== 'string') {
      json = JSON.stringify(jsonMetadata)
    }
    const params = {
      parent_author: parentAuthor,
      parent_permlink: parentPermlink,
      author,
      permlink,
      title,
      body,
      json_metadata: json
    }
    return this.broadcast([['comment', params]], cb)
  }

  public deleteComment(author: string, permlink: string, cb?: CallbackFunction): Promise<SendResponse> {
    const params = {
      author,
      permlink
    }
    return this.broadcast([['delete_comment', params]], cb)
  }

  public customJson(
    requiredAuths: any,
    requiredPostingAuths: any,
    id: string,
    json: any,
    cb?: CallbackFunction
  ): Promise<SendResponse> {
    const params = {
      required_auths: requiredAuths,
      required_posting_auths: requiredPostingAuths,
      id,
      json
    }
    return this.broadcast([['custom_json', params]], cb)
  }

  public reblog(account: string, author: string, permlink: string, cb?: CallbackFunction): Promise<SendResponse> {
    const json = ['reblog', { account, author, permlink }]
    return this.customJson([], [account], 'follow', JSON.stringify(json), cb)
  }

  public follow(follower: string, following: string, cb?: CallbackFunction): Promise<SendResponse> {
    const json = ['follow', { follower, following, what: ['blog'] }]
    return this.customJson([], [follower], 'follow', JSON.stringify(json), cb)
  }

  public unfollow(unfollower: string, unfollowing: string, cb?: CallbackFunction): Promise<SendResponse> {
    const json = ['follow', { follower: unfollower, following: unfollowing, what: <string[]>[] }]
    return this.customJson([], [unfollower], 'follow', JSON.stringify(json), cb)
  }

  public ignore(follower: string, following: string, cb?: CallbackFunction): Promise<SendResponse> {
    const json = ['follow', { follower, following, what: ['ignore'] }]
    return this.customJson([], [follower], 'follow', JSON.stringify(json), cb)
  }

  public claimRewardBalance(
    account: string,
    rewardHive: string,
    rewardHbd: string,
    rewardVests: string,
    cb?: CallbackFunction
  ): Promise<SendResponse> {
    const params = {
      account,
      reward_hive: rewardHive,
      reward_hbd: rewardHbd,
      reward_vests: rewardVests
    }
    return this.broadcast([['claim_reward_balance', params]], cb)
  }

  public async revokeToken(cb?: CallbackFunction): Promise<Client> {
    await this.send('oauth2/token/revoke', 'POST', { token: this.accessToken }, cb)
    return this.removeAccessToken()
  }

  public async send(route: string, method: string, body: any, cb?: CallbackFunction): Promise<SendResponse> {
    const url = `${this.apiURL}/api/${route}`

    if (!cb) {
      return this.makeRequest(url, method, body)
    }

    try {
      const json = await this.makeRequest(url, method, body)
      return cb(null, json)
    } catch (failureResponse) {
      return cb(failureResponse, null)
    }
  }

  public broadcast(operations: Operation[], cb?: CallbackFunction): Promise<SendResponse> {
    return this.send('broadcast', 'POST', { operations }, cb)
  }

  private async makeRequest(url: string, method: string, body: any): Promise<SendResponse> {
    const response = await fetch(url, {
      method,
      headers: {
        Accept: 'application/json, text/plain, */*',
        'Content-Type': 'application/json',
        Authorization: this.accessToken || ''
      },
      body: JSON.stringify(body)
    })

    const json = await response.json()

    if (response.status !== 200 || json.error) {
      throw json
    }

    return json
  }
}
