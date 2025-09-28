import { Asset } from '../types.js'
import { Operation, SignedTransaction, Transaction } from '@hiveio/dhive'

// https://github.com/hive-keychain/keychain-sdk/blob/master/src/interfaces/keychain.interface.ts
interface KeychainTransactionResult {
  tx_id: string
  id: string
  confirmed?: boolean
}

export interface KeychainRequestResponse {
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

export interface KeychainSignTxRequestResponse extends Omit<KeychainRequestResponse, 'result'> {
  result: SignedTransaction
}

export enum KT {
  owner = 'Owner', // unsupported role in keychain
  posting = 'Posting',
  active = 'Active',
  memo = 'Memo'
}

/**
 * Stripped version of keychain-sdk.
 */
export class KeychainMini {
  static isInstalledSync(): boolean {
    return !!window.hive_keychain
  }

  async encode(
    wifKeys: boolean,
    user: string,
    receiver: string | string[],
    msg: string,
    keyType: KT
  ): Promise<KeychainRequestResponse> {
    return new Promise(async (resolve) => {
      const met = `requestEncode${wifKeys ? 'WithKeys' : 'Message'}`
      try {
        window.hive_keychain[met](user, receiver, msg, keyType, (response: KeychainRequestResponse) => {
          resolve(response)
        })
      } catch (error) {
        throw error
      }
    })
  }

  async challenge(decrypt: boolean, user: string, msg: string, keyType: KT, title?: string): Promise<KeychainRequestResponse> {
    return new Promise(async (resolve) => {
      const met = `request${decrypt ? 'VerifyKey' : 'SignBuffer'}`
      try {
        window.hive_keychain[met](
          user,
          msg,
          keyType,
          (response: KeychainRequestResponse) => {
            resolve(response)
          },
          undefined,
          title
        )
      } catch (error) {
        throw error
      }
    })
  }

  async addAuth(
    kind: 'Account' | 'Key',
    user: string,
    newAuth: string,
    role: KT,
    weight: number
  ): Promise<KeychainRequestResponse> {
    return new Promise(async (resolve) => {
      try {
        window.hive_keychain[`requestAdd${kind}Authority`](user, newAuth, role, weight, (response: KeychainRequestResponse) => {
          resolve(response)
        })
      } catch (error) {
        throw error
      }
    })
  }

  async rmAuth(kind: 'Account' | 'Key', user: string, auth: string, role: KT): Promise<KeychainRequestResponse> {
    return new Promise(async (resolve) => {
      try {
        window.hive_keychain[`requestRemove${kind}Authority`](user, auth, role, (response: KeychainRequestResponse) => {
          resolve(response)
        })
      } catch (error) {
        throw error
      }
    })
  }

  async broadcast(user: string, ops: Operation[], method: KT): Promise<KeychainRequestResponse> {
    return new Promise(async (resolve) => {
      try {
        window.hive_keychain.requestBroadcast(user, ops, method, (response: KeychainRequestResponse) => {
          resolve(response)
        })
      } catch (error) {
        throw error
      }
    })
  }

  async signTx(user: string, tx: Transaction, method: KT): Promise<KeychainSignTxRequestResponse> {
    return new Promise(async (resolve) => {
      try {
        window.hive_keychain.requestSignTx(user, tx, method, (response: KeychainSignTxRequestResponse) => {
          resolve(response)
        })
      } catch (error) {
        throw error
      }
    })
  }

  async post(
    user: string,
    title: string,
    body: string,
    pp: string,
    pa: string,
    json: string,
    link: string,
    opts: string
  ): Promise<KeychainRequestResponse> {
    return new Promise(async (resolve) => {
      try {
        window.hive_keychain.requestPost(user, title, body, pp, pa, json, link, opts, (response: KeychainRequestResponse) => {
          resolve(response)
        })
      } catch (error) {
        throw error
      }
    })
  }

  async vote(voter: string, author: string, permlink: string, weight: number): Promise<KeychainRequestResponse> {
    return new Promise(async (resolve) => {
      try {
        window.hive_keychain.requestVote(voter, permlink, author, weight, (response: KeychainRequestResponse) => {
          resolve(response)
        })
      } catch (error) {
        throw error
      }
    })
  }

  async custom(username: string, method: KT, id: string, json: string, display: string): Promise<KeychainRequestResponse> {
    return new Promise(async (resolve) => {
      try {
        window.hive_keychain.requestCustomJson(username, id, method, json, display, (response: KeychainRequestResponse) => {
          resolve(response)
        })
      } catch (error) {
        throw error
      }
    })
  }

  async transfer(from: string, to: string, amount: string, currency: Asset, memo: string): Promise<KeychainRequestResponse> {
    return new Promise(async (resolve) => {
      try {
        window.hive_keychain.requestTransfer(
          from,
          to,
          amount,
          memo,
          currency,
          (response: KeychainRequestResponse) => {
            resolve(response)
          },
          true
        )
      } catch (error) {
        throw error
      }
    })
  }

  async recurrentTransfer(
    from: string,
    to: string,
    amount: string,
    currency: Asset,
    memo: string,
    recurrence: number,
    executions: number
  ): Promise<KeychainRequestResponse> {
    return new Promise(async (resolve) => {
      try {
        window.hive_keychain.requestRecurrentTransfer(
          from,
          to,
          amount,
          currency,
          memo,
          recurrence,
          executions,
          (response: KeychainRequestResponse) => {
            resolve(response)
          }
        )
      } catch (error) {
        throw error
      }
    })
  }

  async delegation(delegator: string, delegatee: string, amount: string, unit: 'HP' | 'VESTS'): Promise<KeychainRequestResponse> {
    return new Promise(async (resolve) => {
      try {
        window.hive_keychain.requestDelegation(delegator, delegatee, amount, unit, (response: KeychainRequestResponse) => {
          resolve(response)
        })
      } catch (error) {
        throw error
      }
    })
  }

  async witnessVote(voter: string, witness: string, approve: boolean): Promise<KeychainRequestResponse> {
    return new Promise(async (resolve) => {
      try {
        window.hive_keychain.requestWitnessVote(voter, witness, approve, (response: KeychainRequestResponse) => {
          resolve(response)
        })
      } catch (error) {
        throw error
      }
    })
  }

  async proxy(user: string, proxy: string): Promise<KeychainRequestResponse> {
    return new Promise(async (resolve) => {
      try {
        window.hive_keychain.requestProxy(user, proxy, (response: KeychainRequestResponse) => {
          resolve(response)
        })
      } catch (error) {
        throw error
      }
    })
  }

  async powerUp(user: string, recipient: string, amount: string): Promise<KeychainRequestResponse> {
    return new Promise(async (resolve) => {
      try {
        window.hive_keychain.requestPowerUp(user, recipient, amount, (response: KeychainRequestResponse) => {
          resolve(response)
        })
      } catch (error) {
        throw error
      }
    })
  }

  async powerDown(user: string, amount: string): Promise<KeychainRequestResponse> {
    return new Promise(async (resolve) => {
      try {
        window.hive_keychain.requestPowerDown(user, amount, (response: KeychainRequestResponse) => {
          resolve(response)
        })
      } catch (error) {
        throw error
      }
    })
  }

  async updateProposalVote(voter: string, proposal_ids: number[], approve: boolean): Promise<KeychainRequestResponse> {
    return new Promise(async (resolve) => {
      try {
        window.hive_keychain.requestUpdateProposalVote(voter, proposal_ids, approve, [], (response: KeychainRequestResponse) => {
          resolve(response)
        })
      } catch (error) {
        throw error
      }
    })
  }

  async vscFer(
    method: 'Transfer' | 'Withdrawal' | 'Staking',
    user: string,
    to: string,
    amount: number,
    asset: string,
    memo?: string,
    net_id?: string
  ): Promise<KeychainRequestResponse> {
    return new Promise(async (rs) => {
      const toUser = to.startsWith('did:') || to.startsWith('hive:') ? to : `hive:${to}`
      try {
        window.hive_keychain[`requestVsc${method}`](
          user,
          toUser,
          amount.toFixed(3),
          asset,
          memo ?? '',
          (response: KeychainRequestResponse) => {
            rs(response)
          },
          net_id
        )
      } catch (error) {
        throw error
      }
    })
  }
}
