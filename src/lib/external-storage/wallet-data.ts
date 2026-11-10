import { KeyTypes } from '../../types.js'

/**
 * Wallet file format used by @hiveio/wax-signers-external.
 * The current version is 3.0.0; older 1.0.0/2.0.0 files are migrated on read.
 */
export const WALLET_DATA_FORMAT_VERSION = '3.0.0'

export type WalletRole = 'posting' | 'active' | 'owner' | 'memo'

export interface WalletKeyEntry {
  privateKey: string
  publicKey?: string
  description?: string
}

export type WalletRoleDefinitions = Partial<Record<WalletRole, WalletKeyEntry>>

export interface WalletAccountData {
  roleDefinitions: WalletRoleDefinitions
}

export interface WalletData {
  version: typeof WALLET_DATA_FORMAT_VERSION
  hive: {
    accounts: Record<string, WalletAccountData>
  }
  generalPurposeKeys?: Record<string, WalletKeyEntry>
}

interface WalletDataV1OrV2 {
  version: string
  hive: {
    account: string
    roleDefinitions: WalletRoleDefinitions
  }
  generalPurposeKeys?: Record<string, WalletKeyEntry>
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const isKeyEntry = (value: unknown): value is WalletKeyEntry =>
  isObject(value) && typeof value.privateKey === 'string'

const parseRoleDefinitions = (value: unknown): WalletRoleDefinitions => {
  const result: WalletRoleDefinitions = {}
  if (!isObject(value)) return result
  for (const role of ['posting', 'active', 'owner', 'memo'] as const)
    if (isKeyEntry(value[role])) result[role] = value[role]
  return result
}

const parseAccounts = (value: unknown): Record<string, WalletAccountData> => {
  const result: Record<string, WalletAccountData> = {}
  if (!isObject(value)) return result
  for (const [account, data] of Object.entries(value)) {
    if (!isObject(data)) continue
    result[account] = { roleDefinitions: parseRoleDefinitions(data.roleDefinitions) }
  }
  return result
}

const parseGeneralPurposeKeys = (value: unknown): Record<string, WalletKeyEntry> | undefined => {
  if (!isObject(value)) return undefined
  const result: Record<string, WalletKeyEntry> = {}
  for (const [alias, entry] of Object.entries(value)) if (isKeyEntry(entry)) result[alias] = entry
  return result
}

/**
 * Parses wallet data of any supported version and migrates it to the current format.
 * @throws Error when the data is not a valid wallet file
 */
export const migrateWalletData = (data: unknown): WalletData => {
  if (!isObject(data)) throw new Error('invalid wallet data')
  if (data.version === WALLET_DATA_FORMAT_VERSION) {
    const hive = isObject(data.hive) ? data.hive : {}
    return {
      version: WALLET_DATA_FORMAT_VERSION,
      hive: { accounts: parseAccounts(hive.accounts) },
      generalPurposeKeys: parseGeneralPurposeKeys(data.generalPurposeKeys)
    }
  }
  if (data.version === '1.0.0' || data.version === '2.0.0') {
    const legacy = data as unknown as WalletDataV1OrV2
    const accounts: Record<string, WalletAccountData> = {}
    if (isObject(legacy.hive) && typeof legacy.hive.account === 'string' && legacy.hive.account.length > 0)
      accounts[legacy.hive.account] = { roleDefinitions: parseRoleDefinitions(legacy.hive.roleDefinitions) }
    return {
      version: WALLET_DATA_FORMAT_VERSION,
      hive: { accounts },
      generalPurposeKeys: parseGeneralPurposeKeys(legacy.generalPurposeKeys)
    }
  }
  throw new Error('unknown wallet data version')
}

/** Creates an empty wallet in the current format. */
export const createEmptyWallet = (): WalletData => ({
  version: WALLET_DATA_FORMAT_VERSION,
  hive: { accounts: {} }
})

/** Returns the role definitions stored for an account. */
export const getRoleDefinitions = (wallet: WalletData, account: string): WalletRoleDefinitions =>
  wallet.hive.accounts[account]?.roleDefinitions ?? {}

/** Stores or replaces a key for an account role. */
export const setWalletKey = (wallet: WalletData, account: string, role: WalletRole, entry: WalletKeyEntry): void => {
  if (!wallet.hive.accounts[account]) wallet.hive.accounts[account] = { roleDefinitions: {} }
  wallet.hive.accounts[account].roleDefinitions[role] = entry
}

/** Removes a key for an account role, dropping the account when it has no keys left. */
export const removeWalletKey = (wallet: WalletData, account: string, role: WalletRole): boolean => {
  const accountData = wallet.hive.accounts[account]
  if (!accountData?.roleDefinitions[role]) return false
  delete accountData.roleDefinitions[role]
  if (Object.keys(accountData.roleDefinitions).length === 0) delete wallet.hive.accounts[account]
  return true
}

/** Converts a wallet role string to a KeyTypes value, when valid. */
export const roleToKeyType = (role: string): KeyTypes | undefined => {
  switch (role) {
    case 'posting':
      return KeyTypes.Posting
    case 'active':
      return KeyTypes.Active
    case 'owner':
      return KeyTypes.Owner
    case 'memo':
      return KeyTypes.Memo
    default:
      return undefined
  }
}
