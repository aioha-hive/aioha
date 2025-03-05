import { Client, Operation, Transaction, Memo, PrivateKey, cryptoUtils } from '@hiveio/dhive'
import { AiohaProviderBase } from '../provider.js'
import { DEFAULT_API, callRest } from '../../rpc.js'
import {
  LoginOptions,
  LoginResult,
  Providers,
  KeyTypes,
  OperationResult,
  SignOperationResult,
  OperationResultObj
} from '../../types.js'
import { SimpleEventEmitter } from '../../lib/event-emitter.js'

interface AccountAuth {
  key_auths: [string, string][]
  account_auths: [string, string][]
  weight_threshold: number
}

interface AccountAuths {
  owner: AccountAuth
  active: AccountAuth
  posting: AccountAuth
  memo: string
  witness_signing: string
}

export class PlaintextKeyProvider extends AiohaProviderBase {
  private provider: Client
  private user?: string
  private wif: PrivateKey

  constructor(wif: string, api: string = DEFAULT_API, emitter: SimpleEventEmitter) {
    super(api, emitter)
    this.provider = new Client(api)
    this.wif = PrivateKey.from(wif)
  }

  async login(username: string, options: LoginOptions): Promise<LoginResult> {
    const signed = await this.signMessage(options!.msg ?? 'Login', options.keyType ?? KeyTypes.Posting)
    if (signed.success)
      return {
        ...signed,
        provider: Providers.Custom,
        username
      }
    else
      return {
        ...signed,
        provider: Providers.Custom
      }
  }

  async loginAndDecryptMemo(username: string, options: LoginOptions): Promise<LoginResult> {
    const r = await this.decryptMemo(options!.msg!, options!.keyType ?? KeyTypes.Posting)
    if (r.success)
      return {
        ...r,
        username: username,
        provider: Providers.Custom
      }
    else
      return {
        ...r,
        provider: Providers.Custom
      }
  }

  async logout() {
    delete this.user
  }

  loadAuth(username: string): boolean {
    this.user = username
    return true
  }

  getUser(): string | undefined {
    return this.user
  }

  async encryptMemo(message: string, keyType: KeyTypes, recipient: string): Promise<OperationResult> {
    try {
      const keys = await callRest<AccountAuths>(`/hafbe-api/accounts/${recipient}/authority`)
      if (!keys[keyType]) throw ''
      const key = keyType === KeyTypes.Memo ? keys.memo : keys[keyType].key_auths[0][0]
      const encoded = Memo.encode(this.wif, key, message)
      return {
        success: true,
        result: encoded
      }
    } catch {
      return {
        success: false,
        errorCode: 5000,
        error: 'failed to encrypt memo'
      }
    }
  }

  async encryptMemoWithKeys(message: string, keyType: KeyTypes, recipientKeys: string[]): Promise<OperationResultObj> {
    try {
      const results: { [pub: string]: string } = {}
      for (let k in recipientKeys) results[recipientKeys[k]] = Memo.encode(this.wif, recipientKeys[k], message)
      return {
        success: true,
        result: results
      }
    } catch {
      return {
        success: false,
        errorCode: 5000,
        error: 'failed to encrypt memo'
      }
    }
  }

  async decryptMemo(memo: string, keyType: KeyTypes): Promise<OperationResult> {
    try {
      const decoded = Memo.decode(this.wif, memo)
      return {
        success: true,
        result: decoded
      }
    } catch {
      return {
        success: false,
        errorCode: 5000,
        error: 'failed to decrypt memo'
      }
    }
  }

  async signMessage(message: string, keyType: KeyTypes): Promise<OperationResult> {
    try {
      const sig = this.wif.sign(cryptoUtils.sha256(message))
      return {
        success: true,
        result: sig.toString(),
        publicKey: this.wif.createPublic().toString()
      }
    } catch {
      return {
        success: false,
        errorCode: 5000,
        error: 'failed to sign message'
      }
    }
  }

  async signTx(tx: Transaction, keyType: KeyTypes): Promise<SignOperationResult> {
    try {
      const signedTx = cryptoUtils.signTransaction(tx, this.wif)
      return {
        success: true,
        result: signedTx
      }
    } catch {
      return {
        success: false,
        errorCode: 5000,
        error: 'failed to sign transaction'
      }
    }
  }

  async signAndBroadcastTx(tx: Operation[], keyType: KeyTypes): Promise<SignOperationResult> {
    try {
      const op = await this.provider.broadcast.sendOperations(tx, this.wif)
      return {
        success: true,
        result: op.id
      }
    } catch {
      return {
        success: false,
        errorCode: 5000,
        error: 'failed to sign and/or broadcast transaction'
      }
    }
  }
}
