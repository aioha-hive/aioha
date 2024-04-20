import { KeychainKeyTypes } from 'keychain-sdk'
import { KeyType as HaKeyType } from './lib/hiveauth-wrapper'

export interface HiveAuthOptions {
  username: string
}

export interface KeychainOptions {
  loginTitle: string
}

export type Providers = 'keychain' | 'hivesigner' | 'hiveauth'

export interface LoginOptions {
  msg?: string
  hivesigner?: {
    state: string
  }
  hiveauth?: {
    authType: HaKeyType
  }
  keychain?: {
    keyType: KeychainKeyTypes
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
