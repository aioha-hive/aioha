import { MessageType as HaMsgType, KeyType as KeyTypes } from './lib/hiveauth-wrapper.js'
export { KeyType as KeyTypes } from './lib/hiveauth-wrapper.js'

export enum Providers {
  Keychain = 'keychain',
  HiveSigner = 'hivesigner',
  HiveAuth = 'hiveauth',
  Ledger = 'ledger',
  PeakVault = 'peakvault',
  Custom = 'custom'
}

export interface LoginOptions {
  msg?: string
  keyType?: KeyTypes
  loginTitle?: string
  hivesigner?: {
    state?: string
  }
  hiveauth?: {
    cbWait?: (payload: string, evt: HaMsgType, cancel: () => void) => any
  }
}

export interface LoginOptionsNI {
  ignorePersistence?: boolean
  hivesigner?: {
    accessToken: string
    expiry: number
  }
}

interface BaseResult {
  success: boolean
}

interface LoginResultSuccess extends BaseResult {
  success: true
  provider: Providers
  result: string
  username: string
  publicKey?: string
}

interface LoginResultError extends BaseResult {
  success: false
  provider?: Providers
  error: string
  errorCode: number
}

export type LoginResult = LoginResultSuccess | LoginResultError

interface OperationError extends BaseResult {
  success: false
  error: string
  errorCode: number
}

interface OperationSuccess extends BaseResult {
  success: true
  result: string
  publicKey?: string
}

export type OperationResult = OperationSuccess | OperationError

interface SignOperationSuccess extends BaseResult {
  success: true
  result: any
}

export type SignOperationResult = SignOperationSuccess | OperationError

export interface VoteParams {
  author: string
  permlink: string
  weight: number
}

export enum Asset {
  HIVE = 'HIVE',
  HBD = 'HBD'
}

export type Events = 'connect' | 'disconnect' | 'account_changed' | 'hiveauth_login_request'
