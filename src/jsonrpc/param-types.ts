import type { Providers, KeyTypes } from '../types.js'
import type { LegacyOperation, LegacyTransaction } from '@aioha/types/dist/hive/legacy.js'

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
  tx: LegacyTransaction
}

export interface SignBroadcastTx extends KeyType {
  ops: LegacyOperation[]
}
