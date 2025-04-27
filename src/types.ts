import type { MessageType as HaMsgType } from './lib/hiveauth-wrapper.js'

export enum Providers {
  Keychain = 'keychain',
  HiveSigner = 'hivesigner',
  HiveAuth = 'hiveauth',
  Ledger = 'ledger',
  PeakVault = 'peakvault',
  Custom = 'custom'
}

export enum KeyTypes {
  Posting = 'posting',
  Active = 'active',
  Memo = 'memo'
}

export interface LoginOptions {
  msg?: string
  keyType?: KeyTypes
  loginTitle?: string
  paths?: string[]
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

export interface LoginResultSuccess extends BaseResult {
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

export interface AccountDiscStreamObj {
  username: string
  path?: string
  pubkey?: string
  role?: string
}
export type AccountDiscStream = (discovered: AccountDiscStreamObj, stop: () => void) => any

export interface OperationError extends BaseResult {
  success: false
  error: string
  errorCode: number
}

export interface OperationSuccess extends BaseResult {
  success: true
  result: string
  publicKey?: string
}

export interface OperationSuccessObj extends BaseResult {
  success: true
  result: object
  publicKey?: string
}

export type OperationResult = OperationSuccess | OperationError
export type OperationResultObj = OperationSuccessObj | OperationError

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

export type Events =
  | 'connect'
  | 'disconnect'
  | 'account_changed'
  | 'hiveauth_login_request'
  | 'hiveauth_challenge_request'
  | 'hiveauth_sign_request'
  | 'login_request'
  | 'memo_request'
  | 'sign_msg_request'
  | 'sign_tx_request'

export interface PersistentLoginBase {
  provider: Providers
  pubKey?: string
}

export interface PersistentLoginLedger extends PersistentLoginBase {
  provider: Providers.Ledger
  path: string
}

export interface PersistentLoginHiveAuth extends PersistentLoginBase {
  provider: Providers.HiveAuth
  token?: string
  key: string
  exp: number
}

export interface PersistentLoginHiveSigner extends PersistentLoginBase {
  provider: Providers.HiveSigner
  token: string
  exp: number
}

export type PersistentLogin = PersistentLoginBase | PersistentLoginLedger | PersistentLoginHiveAuth | PersistentLoginHiveSigner
export type PersistentLogins = { [username: string]: PersistentLogin }
export type PersistentLoginProvs = { [username: string]: Providers }

export type VscFer = 'transfer' | 'withdraw' | 'consensus_stake' | 'consensus_unstake' | 'stake_hbd' | 'unstake_hbd'
export enum VscStakeType {
  Consensus,
  HBD
}
