/*
 * Wallet file format handling for the Aioha external wallet provider.
 * Compatible with the wallet data format used by @hiveio/wax-signers-external.
 */

export const DATA_FORMAT_VERSIONS = {
  V1: '1.0.0',
  V2: '2.0.0',
  V3: '3.0.0'
} as const

export type WalletRole = 'posting' | 'active' | 'owner' | 'memo'

export interface IWalletKeyEntry {
  privateKey: string
  publicKey?: string
  description?: string
}

export type IWalletHiveRoleDefinitions = Partial<Record<WalletRole, IWalletKeyEntry>>

export interface IWalletHiveAccountData {
  roleDefinitions: IWalletHiveRoleDefinitions
}

export interface IWalletDataV3 {
  version: typeof DATA_FORMAT_VERSIONS.V3
  hive: {
    accounts: Record<string, IWalletHiveAccountData>
  }
  generalPurposeKeys?: Record<string, IWalletKeyEntry>
}

interface IWalletDataV1OrV2 {
  version: string
  hive: {
    account: string
    roleDefinitions: IWalletHiveRoleDefinitions
  }
  generalPurposeKeys?: Record<string, IWalletKeyEntry>
}

const isKeyEntry = (value: unknown): value is IWalletKeyEntry => {
  if (typeof value !== 'object' || value === null) return false
  const entry = value as Record<string, unknown>
  return typeof entry.privateKey === 'string'
}

const parseRoleDefinitions = (value: unknown): IWalletHiveRoleDefinitions => {
  const result: IWalletHiveRoleDefinitions = {}
  if (typeof value !== 'object' || value === null) return result
  for (const role of ['posting', 'active', 'owner', 'memo'] as const) {
    const entry = (value as Record<string, unknown>)[role]
    if (isKeyEntry(entry)) result[role] = entry
  }
  return result
}

const parseAccounts = (value: unknown): Record<string, IWalletHiveAccountData> => {
  const result: Record<string, IWalletHiveAccountData> = {}
  if (typeof value !== 'object' || value === null) return result
  for (const [account, data] of Object.entries(value as Record<string, unknown>)) {
    if (typeof data !== 'object' || data === null) continue
    result[account] = { roleDefinitions: parseRoleDefinitions((data as Record<string, unknown>).roleDefinitions) }
  }
  return result
}

const parseGeneralPurposeKeys = (value: unknown): Record<string, IWalletKeyEntry> | undefined => {
  if (typeof value !== 'object' || value === null) return undefined
  const result: Record<string, IWalletKeyEntry> = {}
  for (const [alias, entry] of Object.entries(value as Record<string, unknown>)) {
    if (isKeyEntry(entry)) result[alias] = entry
  }
  return result
}

/**
 * Parses wallet data of any version and migrates it to the current V3 format.
 * @throws Error when the data is not a valid wallet file
 */
export const migrateWalletData = (data: unknown): IWalletDataV3 => {
  if (typeof data !== 'object' || data === null) throw new Error('Invalid wallet data')
  const wallet = data as Record<string, any>
  if (wallet.version === DATA_FORMAT_VERSIONS.V3) {
    return {
      version: DATA_FORMAT_VERSIONS.V3,
      hive: { accounts: parseAccounts(wallet.hive?.accounts) },
      generalPurposeKeys: parseGeneralPurposeKeys(wallet.generalPurposeKeys)
    }
  } else if (wallet.version === DATA_FORMAT_VERSIONS.V1 || wallet.version === DATA_FORMAT_VERSIONS.V2) {
    const legacy = wallet as IWalletDataV1OrV2
    const accounts: Record<string, IWalletHiveAccountData> = {}
    if (typeof legacy.hive?.account === 'string' && legacy.hive.account.length > 0) {
      accounts[legacy.hive.account] = { roleDefinitions: parseRoleDefinitions(legacy.hive.roleDefinitions) }
    }
    return {
      version: DATA_FORMAT_VERSIONS.V3,
      hive: { accounts },
      generalPurposeKeys: parseGeneralPurposeKeys(legacy.generalPurposeKeys)
    }
  }
  throw new Error('Unknown wallet data version')
}

/** Creates an empty wallet data structure in V3 format. */
export const createEmptyWalletData = (): IWalletDataV3 => ({
  version: DATA_FORMAT_VERSIONS.V3,
  hive: { accounts: {} }
})
