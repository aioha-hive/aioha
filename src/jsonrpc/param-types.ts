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

export interface SignTx extends KeyType {
  tx: Transaction
}

export interface SignBroadcastTx extends KeyType {
  ops: Operation[]
}
