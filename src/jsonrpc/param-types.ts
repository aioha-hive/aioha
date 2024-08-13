import type { Providers, KeyTypes } from '../types.js'
import type { Operation, Transaction } from '@hiveio/dhive'

export interface IsProviderRegistered {
  provider: Providers
  enabled: boolean
}

export interface KeyType {
  key_type: KeyTypes
}

export interface MessageKeyType extends KeyType {
  message: string
}

export interface Login extends MessageKeyType {
  provider: Providers
  username: string
  login_title?: string
}

export interface SignTx extends KeyType {
  tx: Transaction
}

export interface SignBroadcastTx extends KeyType {
  ops: Operation[]
}

export interface LoginParam {
  provider: Providers
  username: string
  message: string
  key_type: KeyTypes
}
