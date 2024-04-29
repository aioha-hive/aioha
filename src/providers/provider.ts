import { CommentOptionsOperation, Operation, Transaction } from '@hiveio/dhive'
import { KeyTypes, LoginOptions, LoginResult, OperationResult, SignOperationResult } from '../types'

export interface AiohaProvider {
  // authentication
  login(username: string, options: LoginOptions): Promise<LoginResult>
  loginAndDecryptMemo(username: string, options: LoginOptions): Promise<LoginResult>
  logout(): Promise<void>
  loadAuth(username: string): boolean

  // memo
  decryptMemo(memo: string, keyType: KeyTypes): Promise<OperationResult>

  // sign message
  signMessage(message: string, keyType: KeyTypes): Promise<OperationResult>

  // sign and optionally broadcast generic transaction
  signTx(tx: Transaction, keyType: KeyTypes): Promise<SignOperationResult>
  signAndBroadcastTx(tx: Operation[], keyType: KeyTypes): Promise<SignOperationResult>

  // posting auth operation helpers
  vote(author: string, permlink: string, weight: number): Promise<SignOperationResult>
  comment(
    pa: string | null,
    pp: string | null,
    permlink: string,
    title: string,
    body: string,
    json: string,
    options?: CommentOptionsOperation[1]
  ): Promise<SignOperationResult>
  deleteComment(permlink: string): Promise<SignOperationResult>
  customJSON(
    required_auths: string[],
    required_posting_auths: string[],
    id: string,
    json: string,
    displayTitle?: string
  ): Promise<SignOperationResult>
}
