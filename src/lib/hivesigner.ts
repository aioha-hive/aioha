import { CallbackFunction, ClientConfig, SendResponse } from './hivesigner-types.js'
import { Operation } from '@hiveio/dhive'

const API_URL = 'https://hivesigner.com'
const BASE_URL = 'https://hivesigner.com'

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

  /*
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
  */

  public setAccessToken(accessToken: string): this {
    this.accessToken = accessToken
    return this
  }

  public removeAccessToken(): this {
    delete this.accessToken
    return this
  }

  /*
  public setScope(scope: string[]): this {
    this.scope = scope
    return this
  }
  */

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

  /*
  public me(cb?: CallbackFunction): Promise<SendResponse> {
    return this.send('me', 'POST', {}, cb)
  }
  */

  public decode(memo: string, cb?: CallbackFunction): Promise<SendResponse> {
    return this.send('decode', 'POST', { memo: memo }, cb)
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
