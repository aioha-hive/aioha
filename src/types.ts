import { BeneficiaryRoute } from '@hiveio/dhive'
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

export interface CommentOptions {
  max_accepted_payout: string
  percent_hbd: number
  allow_votes: boolean
  allow_curation_rewards: boolean
  beneficiaries: BeneficiaryRoute[]
}

export interface AuthorLink {
  author: string
  permlink: string
}

export interface VoteParams extends AuthorLink {
  weight: number
}

export interface CustomJSONPayload {
  required_auths: string[]
  required_posting_auths: string[]
  id: string
  json: string
}
