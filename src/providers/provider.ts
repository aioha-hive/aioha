import { Operation, Transaction } from '@hiveio/dhive'
import { KeyTypes, LoginOptions, LoginResult, OperationResult, SignOperationResult } from '../types'

export abstract class AiohaProvider {
  protected provider: any

  constructor(options?: any) {}

  // authentication
  abstract login(username: string, options: LoginOptions): Promise<LoginResult>
  abstract loginAndDecryptMemo(username: string, options: LoginOptions): Promise<LoginResult>
  abstract logout(): Promise<void>
  abstract loadAuth(username: string): boolean

  // memo
  abstract decryptMemo(memo: string, keyType: KeyTypes): Promise<OperationResult>

  // sign message
  abstract signMessage(message: string, keyType: KeyTypes): Promise<OperationResult>

  // sign and optionally broadcast generic transaction
  abstract signTx(tx: Transaction, keyType: KeyTypes): Promise<SignOperationResult>
  abstract signAndBroadcastTx(tx: Operation[], keyType: KeyTypes): Promise<SignOperationResult>
}
