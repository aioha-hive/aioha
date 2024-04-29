import { KeychainKeyTypes, KeychainRequestResponse, KeychainSDK, Post } from 'keychain-sdk'
import { Operation, Transaction, CommentOptionsOperation } from '@hiveio/dhive'
import { AiohaProvider } from './provider.js'
import { KeyTypes, KeychainOptions, LoginOptions, LoginResult, OperationResult, SignOperationResult } from '../types.js'
import assert from 'assert'
import { createCustomJSON } from '../opbuilder.js'

export class Keychain implements AiohaProvider {
  private provider: KeychainSDK
  private loginTitle: string = 'Login'
  private username?: string

  constructor(options?: KeychainOptions) {
    this.provider = new KeychainSDK(window)
    if (options && options.loginTitle) this.loginTitle = options.loginTitle
  }

  async login(username: string, options: LoginOptions): Promise<LoginResult> {
    if (!options || !options.keychain)
      return {
        provider: 'keychain',
        success: false,
        error: 'keyType options are required'
      }
    else if (!(await Keychain.isInstalled()))
      return {
        provider: 'keychain',
        success: false,
        error: 'Keychain extension is not installed'
      }
    const login = await this.provider.login({
      username: username,
      message: options.msg,
      method: Keychain.mapAiohaKeyTypes(options.keychain.keyType),
      title: this.loginTitle
    })
    if (login.success) this.username = username
    return {
      provider: 'keychain',
      success: login.success,
      message: login.message,
      result: login.result,
      publicKey: login.publicKey
    }
  }

  async loginAndDecryptMemo(username: string, options: LoginOptions): Promise<LoginResult> {
    if (!options.msg || !options.msg.startsWith('#'))
      return {
        provider: 'keychain',
        success: false,
        error: 'message to decode must start with #'
      }
    else if (!options || !options.keychain)
      return {
        provider: 'keychain',
        success: false,
        error: 'keyType options are required'
      }
    else if (!(await Keychain.isInstalled()))
      return {
        provider: 'keychain',
        success: false,
        error: 'Keychain extension is not installed'
      }
    const login = await this.provider.decode({
      username: username,
      message: options.msg,
      method: Keychain.mapAiohaKeyTypes(options.keychain.keyType)
    })
    if (login.success) this.username = username
    return {
      provider: 'keychain',
      success: login.success,
      message: login.message,
      result: login.result as unknown as string
    }
  }

  async logout(): Promise<void> {
    delete this.username
  }

  loadAuth(username: string): boolean {
    this.username = username
    return true
  }

  static isInstalled(): Promise<boolean> {
    return new KeychainSDK(window).isKeychainInstalled()
  }

  static mapAiohaKeyTypes(keyType: KeyTypes): KeychainKeyTypes {
    switch (keyType) {
      case 'posting':
        return KeychainKeyTypes.posting
      case 'active':
        return KeychainKeyTypes.active
      case 'memo':
        return KeychainKeyTypes.memo
    }
  }

  async decryptMemo(memo: string, keyType: KeyTypes): Promise<OperationResult> {
    assert(typeof this.username === 'string')
    const kcKeyType = Keychain.mapAiohaKeyTypes(keyType)
    const decoded = await this.provider.decode({
      username: this.username,
      message: memo,
      method: kcKeyType
    })
    return {
      success: decoded.success,
      error: decoded.error ? decoded.message : undefined,
      result: decoded.result as unknown as string
    }
  }

  async signMessage(message: string, keyType: KeyTypes): Promise<OperationResult> {
    assert(typeof this.username === 'string')
    const kcKeyType = Keychain.mapAiohaKeyTypes(keyType)
    const signBuf = await this.provider.signBuffer({
      username: this.username,
      message,
      method: kcKeyType
    })
    if (!signBuf.success)
      return {
        success: false,
        error: signBuf.error
      }
    return {
      success: signBuf.success,
      message: signBuf.message,
      result: signBuf.result as unknown as string,
      publicKey: signBuf.publicKey
    }
  }

  async signTx(tx: Transaction, keyType: KeyTypes): Promise<SignOperationResult> {
    assert(typeof this.username === 'string')
    const kcKeyType = Keychain.mapAiohaKeyTypes(keyType)
    const signedTx = await this.provider.signTx({
      username: this.username,
      tx,
      method: kcKeyType
    })
    if (!signedTx.success)
      return {
        success: false,
        error: signedTx.error
      }
    return {
      success: signedTx.success,
      message: signedTx.message,
      result: signedTx.result
    }
  }

  async signAndBroadcastTx(tx: Operation[], keyType: KeyTypes): Promise<SignOperationResult> {
    assert(typeof this.username === 'string')
    const kcKeyType = Keychain.mapAiohaKeyTypes(keyType)
    try {
      const broadcastedTx = await this.provider.broadcast({
        username: this.username,
        operations: tx,
        method: kcKeyType
      })
      return this.txResult(broadcastedTx)
    } catch (e) {
      return {
        success: false,
        error: (e as KeychainRequestResponse).message
      }
    }
  }

  txResult(tx: KeychainRequestResponse): SignOperationResult {
    if (!tx.success)
      return {
        success: false,
        error: tx.message
      }
    return {
      success: tx.success,
      message: tx.message,
      result: tx.result!.id
    }
  }

  async vote(author: string, permlink: string, weight: number): Promise<SignOperationResult> {
    assert(typeof this.username === 'string')
    const tx = await this.provider.vote({
      username: this.username,
      author,
      permlink,
      weight
    })
    return this.txResult(tx)
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
    const tx = await this.provider.post({
      username: this.username,
      permlink,
      title,
      body,
      json_metadata: json,
      parent_username: pa ?? '',
      parent_perm: pp ?? '',
      comment_options: options ? JSON.stringify(options) : ''
    })
    return this.txResult(tx)
  }

  async deleteComment(permlink: string): Promise<SignOperationResult> {
    throw new Error('Method not implemented.')
  }

  async customJSON(
    required_auths: string[],
    required_posting_auths: string[],
    id: string,
    json: string,
    displayTitle?: string
  ): Promise<SignOperationResult> {
    assert(this.username && (required_auths.length > 0 || required_posting_auths.length > 0))
    if (required_auths.length === 0 || required_posting_auths.length === 0)
      return this.txResult(
        await this.provider.custom({
          username: this.username,
          method: required_auths.length > 0 ? KeychainKeyTypes.active : KeychainKeyTypes.posting,
          display_msg: displayTitle ?? 'Custom JSON',
          id,
          json
        })
      )
    else return await this.signAndBroadcastTx([createCustomJSON(required_auths, required_posting_auths, id, json)], 'active')
  }
}
