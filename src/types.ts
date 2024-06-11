import { MessageType as HaMsgType, KeyType as KeyTypes } from './lib/hiveauth-wrapper'
export { KeyType as KeyTypes } from './lib/hiveauth-wrapper'

export enum Providers {
  Keychain = 'keychain',
  HiveSigner = 'hivesigner',
  HiveAuth = 'hiveauth',
  Ledger = 'ledger',
  PeakVault = 'peakvault'
}

export interface LoginOptions {
  msg?: string
  keyType?: KeyTypes
  loginTitle?: string
  hivesigner?: {
    state?: string
  }
  hiveauth?: {
    cbWait?: (payload: string, evt: HaMsgType) => any
  }
}

export interface LoginResult {
  provider?: Providers
  success: boolean
  error?: string
  result?: string
  message?: string
  username?: string
  publicKey?: string
}

interface OperationBaseResult {
  success: boolean
  error?: string
  message?: string
}

export interface OperationResult extends OperationBaseResult {
  result?: string
  publicKey?: string
}

export interface SignOperationResult extends OperationBaseResult {
  result?: any
}

export interface VoteParams {
  author: string
  permlink: string
  weight: number
}

export enum Asset {
  HIVE = 'HIVE',
  HBD = 'HBD'
}
