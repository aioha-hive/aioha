import { KeyType as HaKeyType } from './lib/hiveauth-wrapper'
import { MessageType as HaMsgType } from './lib/hiveauth-wrapper'

export interface KeychainOptions {
  loginTitle: string
}

export type Providers = 'keychain' | 'hivesigner' | 'hiveauth'
export type KeyTypes = HaKeyType

export interface LoginOptions {
  msg?: string
  hivesigner?: {
    state?: string
  }
  hiveauth?: {
    authType: HaKeyType
    cbWait?: (payload: string, evt: HaMsgType) => any
  }
  keychain?: {
    keyType: KeyTypes
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

export interface OperationResult {
  success: boolean
  error?: string | null
  result?: string
  message?: string
  publicKey?: string
}
