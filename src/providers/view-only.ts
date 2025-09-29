import { error } from '../lib/errors.js'
import {
  LoginResult,
  PersistentLogin,
  OperationResult,
  OperationResultObj,
  SignOperationResultObj,
  SignOperationResult,
  Providers
} from '../types.js'
import { AiohaProviderBase } from './provider.js'

const VIEW_ONLY_ERR = error(4200, 'Cannot sign or transact in view only mode')

export class ViewOnly extends AiohaProviderBase {
  private user?: string

  constructor() {
    super('')
  }

  async login(username: string): Promise<LoginResult> {
    this.user = username
    return {
      provider: Providers.ViewOnly,
      success: true,
      username,
      result: ''
    }
  }
  loginAndDecryptMemo(username: string): Promise<LoginResult> {
    return this.login(username)
  }
  async logout(): Promise<void> {
    delete this.user
  }
  loadAuth(username: string): boolean {
    this.user = username
    return true
  }
  getUser(): string | undefined {
    return this.user
  }
  getLoginInfo(): PersistentLogin | undefined {
    return {
      provider: Providers.ViewOnly
    }
  }
  loadLogin(username: string, info: PersistentLogin): boolean {
    return this.loadAuth(username)
  }
  async encryptMemo(): Promise<OperationResult> {
    return VIEW_ONLY_ERR
  }
  async encryptMemoWithKeys(): Promise<OperationResultObj> {
    return VIEW_ONLY_ERR
  }
  async decryptMemo(): Promise<OperationResult> {
    return VIEW_ONLY_ERR
  }
  async signMessage(): Promise<OperationResult> {
    return VIEW_ONLY_ERR
  }
  async signTx(): Promise<SignOperationResultObj> {
    return VIEW_ONLY_ERR
  }
  async signAndBroadcastTx(): Promise<SignOperationResult> {
    return VIEW_ONLY_ERR
  }
}
