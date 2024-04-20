import { KeychainKeyTypes } from 'keychain-sdk'
import { KeyType as HaKeyType } from './lib/hiveauth-wrapper'
import { MessageType as HaMsgType } from './lib/hiveauth-wrapper'

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
    cbWait?: (evt: HaMsgType) => any
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
