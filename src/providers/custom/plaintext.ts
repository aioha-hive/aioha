import { Client, Operation, Transaction, Memo, PrivateKey, cryptoUtils } from '@hiveio/dhive'
import { AiohaProviderBase } from '../provider.js'
import { DEFAULT_API } from '../../rpc.js'
import { LoginOptions, LoginResult, Providers, KeyTypes, OperationResult, SignOperationResult } from '../../types.js'

export class PlaintextKeyProvider extends AiohaProviderBase {
  private provider: Client
  private user?: string
  private wif: PrivateKey

  constructor(wif: string, api: string = DEFAULT_API) {
    super(api)
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
