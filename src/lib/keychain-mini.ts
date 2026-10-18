import type { LegacySignedTransaction } from '@aioha/types/dist/hive/legacy.js'

// https://github.com/hive-keychain/keychain-sdk/blob/master/src/interfaces/keychain.interface.ts
interface KeychainTransactionResult {
  tx_id: string
  id: string
  confirmed?: boolean
}

export interface KeychainResponse {
  success: boolean
  error: string
  result?: KeychainTransactionResult
  data: {
    key: string
    message: string
    method: string
    receiver: string
    request_id: number
    type: string
    username: string
  }
  message: string
  request_id: number
  publicKey?: string
}

export interface KeychainSignTxResponse extends Omit<KeychainResponse, 'result'> {
  result: LegacySignedTransaction
}

export enum KT {
  owner = 'Owner', // unsupported role in keychain
  posting = 'Posting',
  active = 'Active',
  memo = 'Memo'
}

type Prf<T> = (r: (v: T) => void) => void
export const p = <T = KeychainResponse>(f: Prf<T>): Promise<T> => new Promise<T>((r) => f(r))
export const wk = () => window.hive_keychain

/**
 * Stripped version of keychain-sdk.
 */
export class KeychainMini {
  async encode(wifKeys: boolean, user: string, receiver: string | string[], msg: string, keyType: KT): Promise<KeychainResponse> {
    return p((r) => {
      const met = `requestEncode${wifKeys ? 'WithKeys' : 'Message'}`
      wk()[met](user, receiver, msg, keyType, (response: KeychainResponse) => {
        r(response)
      })
    })
  }

  async challenge(decrypt: boolean, user: string, msg: string, keyType: KT, title?: string): Promise<KeychainResponse> {
    return p((r) => {
      const met = `request${decrypt ? 'VerifyKey' : 'SignBuffer'}`
      wk()[met](user, msg, keyType, (response: KeychainResponse) => r(response), undefined, title)
    })
  }

  async addAuth(kind: 'Account' | 'Key', user: string, newAuth: string, role: KT, weight: number): Promise<KeychainResponse> {
    return p((r) => {
      wk()[`requestAdd${kind}Authority`](user, newAuth, role, weight, (response: KeychainResponse) => r(response))
    })
  }

  async rmAuth(kind: 'Account' | 'Key', user: string, auth: string, role: KT): Promise<KeychainResponse> {
    return p((r) => {
      wk()[`requestRemove${kind}Authority`](user, auth, role, (response: KeychainResponse) => r(response))
    })
  }

  async delegation(delegator: string, delegatee: string, amount: string, unit: 'HP' | 'VESTS'): Promise<KeychainResponse> {
    return p((r) => {
      wk().requestDelegation(delegator, delegatee, amount, unit, (response: KeychainResponse) => r(response))
    })
  }
}
