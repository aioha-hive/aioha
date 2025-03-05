import { KeychainRequestResponse } from 'keychain-sdk'
import { Operation, Transaction, CommentOptionsOperation } from '@hiveio/dhive'
import { AiohaProviderBase } from './provider.js'
import {
  Asset,
  KeyTypes,
  LoginOptions,
  LoginResult,
  OperationResult,
  OperationResultObj,
  Providers,
  SignOperationResult
} from '../types.js'
import { KeychainMini } from '../lib/keychain-mini.js'

enum KeychainKeyTypes {
  posting = 'Posting',
  active = 'Active',
  memo = 'Memo'
}

const getErrorCode = (resp: any): number => {
  if (typeof resp.error === 'string' && resp.error === 'user_cancel') return 4001
  else if (typeof resp.error === 'object' && typeof resp.error.code === 'number') return resp.error.code
  else return 5000
}

export class Keychain extends AiohaProviderBase {
  private provider: KeychainMini
  private username: string

  constructor() {
    super('') // api url isn't used here
    this.provider = new KeychainMini()
    this.username = ''
  }

  async login(username: string, options: LoginOptions): Promise<LoginResult> {
    if (!options || !options.keyType)
      return {
        provider: Providers.Keychain,
        success: false,
        errorCode: 5003,
        error: 'keyType options are required'
      }
    else if (!(await this.provider.isKeychainInstalled()))
      return {
        provider: Providers.Keychain,
        success: false,
        errorCode: 5001,
        error: 'Keychain extension is not installed'
      }
    const login = await this.provider.login({
      username: username,
      message: options.msg,
      method: Keychain.mapAiohaKeyTypes(options.keyType),
      title: options.loginTitle
    })
    if (login.success) this.username = username
    return {
      provider: Providers.Keychain,
      success: login.success,
      error: !login.success ? login.message : undefined,
      result: login.result,
      publicKey: login.publicKey,
      username
    }
  }

  async loginAndDecryptMemo(username: string, options: LoginOptions): Promise<LoginResult> {
    if (!options || !options.keyType)
      return {
        provider: Providers.Keychain,
        success: false,
        errorCode: 5003,
        error: 'keyType options are required'
      }
    else if (!(await this.provider.isKeychainInstalled()))
      return {
        provider: Providers.Keychain,
        success: false,
        errorCode: 5001,
        error: 'Keychain extension is not installed'
      }
    const login = await this.provider.decode({
      username: username,
      message: options.msg!,
      method: Keychain.mapAiohaKeyTypes(options.keyType)
    })
    if (login.success) this.username = username
    if (login.success) {
      return {
        provider: Providers.Keychain,
        success: true,
        result: login.result as unknown as string,
        username
      }
    }
    return {
      provider: Providers.Keychain,
      success: false,
      errorCode: getErrorCode(login),
      error: login.message
    }
  }

  async logout(): Promise<void> {
    this.username = ''
  }

  loadAuth(username: string): boolean {
    this.username = username
    return true
  }

  getUser(): string | undefined {
    return this.username
  }

  static isInstalled(): boolean {
    return KeychainMini.isKeychainInstalledSync()
  }

  static mapAiohaKeyTypes(keyType: KeyTypes): KeychainKeyTypes {
    switch (keyType) {
      case KeyTypes.Posting:
        return KeychainKeyTypes.posting
      case KeyTypes.Active:
        return KeychainKeyTypes.active
      case KeyTypes.Memo:
        return KeychainKeyTypes.memo
    }
  }

  async encryptMemo(message: string, keyType: KeyTypes, recipient: string): Promise<OperationResult> {
    const kcKeyType = Keychain.mapAiohaKeyTypes(keyType)
    const encoded = await this.provider.encode({
      username: this.username,
      message,
      receiver: recipient,
      method: kcKeyType
    })
    if (encoded.success)
      return {
        success: true,
        result: encoded.result as unknown as string
      }
    else
      return {
        success: false,
        errorCode: getErrorCode(encoded),
        error: encoded.message
      }
  }

  async encryptMemoWithKeys(message: string, keyType: KeyTypes, recipientKeys: string[]): Promise<OperationResultObj> {
    const kcKeyType = Keychain.mapAiohaKeyTypes(keyType)
    const encoded = await this.provider.encodeWithKeys({
      username: this.username,
      message,
      publicKeys: recipientKeys,
      method: kcKeyType
    })
    if (encoded.success)
      return {
        success: true,
        result: encoded.result as unknown as object
      }
    else
      return {
        success: false,
        errorCode: getErrorCode(encoded),
        error: encoded.message
      }
  }

  async decryptMemo(memo: string, keyType: KeyTypes): Promise<OperationResult> {
    const kcKeyType = Keychain.mapAiohaKeyTypes(keyType)
    const decoded = await this.provider.decode({
      username: this.username,
      message: memo,
      method: kcKeyType
    })
    if (decoded.success)
      return {
        success: true,
        result: decoded.result as unknown as string
      }
    else
      return {
        success: false,
        errorCode: getErrorCode(decoded),
        error: decoded.message
      }
  }

  async signMessage(message: string, keyType: KeyTypes): Promise<OperationResult> {
    const kcKeyType = Keychain.mapAiohaKeyTypes(keyType)
    const signBuf = await this.provider.signBuffer({
      username: this.username,
      message,
      method: kcKeyType
    })
    if (!signBuf.success)
      return {
        success: false,
        errorCode: getErrorCode(signBuf),
        error: signBuf.error
      }
    return {
      success: signBuf.success,
      result: signBuf.result as unknown as string,
      publicKey: signBuf.publicKey
    }
  }

  async signTx(tx: Transaction, keyType: KeyTypes): Promise<SignOperationResult> {
    const kcKeyType = Keychain.mapAiohaKeyTypes(keyType)
    const signedTx = await this.provider.signTx({
      username: this.username,
      tx,
      method: kcKeyType
    })
    if (!signedTx.success)
      return {
        success: false,
        errorCode: getErrorCode(signedTx),
        error: signedTx.error
      }
    return {
      success: signedTx.success,
      result: signedTx.result
    }
  }

  async signAndBroadcastTx(tx: Operation[], keyType: KeyTypes): Promise<SignOperationResult> {
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
        errorCode: getErrorCode(e),
        error: (e as KeychainRequestResponse).message
      }
    }
  }

  txResult(tx: KeychainRequestResponse): SignOperationResult {
    if (!tx.success)
      return {
        success: false,
        errorCode: getErrorCode(tx),
        error: tx.message
      }
    return {
      success: tx.success,
      result: tx.result!.id
    }
  }

  async vote(author: string, permlink: string, weight: number): Promise<SignOperationResult> {
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
    // remove when and if keychain fixes this issue
    if (pa && pp) return await super.comment(pa, pp, permlink, title, body, json, options)
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

  async customJSON(keyType: KeyTypes, id: string, json: string, displayTitle?: string): Promise<SignOperationResult> {
    return this.txResult(
      await this.provider.custom({
        username: this.username,
        method: Keychain.mapAiohaKeyTypes(keyType),
        display_msg: displayTitle ?? 'Custom JSON',
        id,
        json
      })
    )
  }

  async transfer(to: string, amount: number, currency: Asset, memo?: string): Promise<SignOperationResult> {
    return this.txResult(
      await this.provider.transfer({
        username: this.username,
        to,
        amount: amount.toFixed(3),
        memo: memo ?? '',
        enforce: true,
        currency
      })
    )
  }

  async recurrentTransfer(
    to: string,
    amount: number,
    currency: Asset,
    recurrence: number,
    executions: number,
    memo?: string
  ): Promise<SignOperationResult> {
    return this.txResult(
      await this.provider.recurrentTransfer({
        username: this.username,
        to,
        amount: amount.toFixed(3),
        currency,
        memo: memo ?? '',
        recurrence,
        executions
      })
    )
  }

  async stakeHive(amount: number, to?: string): Promise<SignOperationResult> {
    return this.txResult(
      await this.provider.powerUp({
        username: this.username,
        recipient: to ?? this.username,
        hive: amount.toFixed(3)
      })
    )
  }

  async unstakeHive(amount: number): Promise<SignOperationResult> {
    return this.txResult(
      await this.provider.powerDown({
        username: this.username,
        hive_power: amount.toFixed(3)
      })
    )
  }

  async delegateStakedHive(to: string, amount: number): Promise<SignOperationResult> {
    return this.txResult(
      await this.provider.delegation({
        username: this.username,
        delegatee: to,
        amount: amount.toFixed(3),
        unit: 'HP'
      })
    )
  }

  async delegateVests(to: string, amount: number): Promise<SignOperationResult> {
    return this.txResult(
      await this.provider.delegation({
        username: this.username,
        delegatee: to,
        amount: amount.toFixed(6),
        unit: 'VESTS'
      })
    )
  }

  async voteWitness(witness: string, approve: boolean): Promise<SignOperationResult> {
    return this.txResult(
      await this.provider.witnessVote({
        username: this.username,
        witness,
        vote: approve
      })
    )
  }

  async voteProposals(proposals: number[], approve: boolean): Promise<SignOperationResult> {
    return this.txResult(
      await this.provider.updateProposalVote({
        username: this.username,
        proposal_ids: proposals,
        approve,
        extensions: []
      })
    )
  }

  async setProxy(proxy: string): Promise<SignOperationResult> {
    return this.txResult(
      await this.provider.proxy({
        username: this.username,
        proxy
      })
    )
  }

  async addAccountAuthority(username: string, role: KeyTypes, weight: number): Promise<SignOperationResult> {
    return this.txResult(
      await this.provider.addAccountAuthority({
        username: this.username,
        authorizedUsername: username,
        role: Keychain.mapAiohaKeyTypes(role),
        weight
      })
    )
  }

  async removeAccountAuthority(username: string, role: KeyTypes): Promise<SignOperationResult> {
    return this.txResult(
      await this.provider.removeAccountAuthority({
        username: this.username,
        authorizedUsername: username,
        role: Keychain.mapAiohaKeyTypes(role)
      })
    )
  }

  async addKeyAuthority(publicKey: string, role: KeyTypes, weight: number): Promise<SignOperationResult> {
    return this.txResult(
      await this.provider.addKeyAuthority({
        username: this.username,
        authorizedKey: publicKey,
        role: Keychain.mapAiohaKeyTypes(role),
        weight
      })
    )
  }

  async removeKeyAuthority(publicKey: string, role: KeyTypes): Promise<SignOperationResult> {
    return this.txResult(
      await this.provider.removeKeyAuthority({
        username: this.username,
        authorizedKey: publicKey,
        role: Keychain.mapAiohaKeyTypes(role)
      })
    )
  }
}
