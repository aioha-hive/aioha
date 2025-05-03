import {
  Broadcast,
  Custom,
  Delegation,
  Login,
  PowerDown,
  PowerUp,
  Proxy,
  RecurrentTransfer,
  SignTx,
  Transfer,
  UpdateProposalVote,
  Vote,
  WitnessVote,
  KeychainKeyTypes as KT
} from 'keychain-sdk/dist/interfaces/keychain-sdk.interface'
import { KeychainRequestResponse, KeychainSignTxRequestResponse } from 'keychain-sdk/dist/interfaces/keychain.interface'

/**
 * Stripped version of keychain-sdk.
 */
export class KeychainMini {
  static isInstalledSync(): boolean {
    return !!window.hive_keychain
  }

  async login(data: Login): Promise<any> {
    return await this.challenge(false, data.username ?? '', data.message ?? window.crypto.randomUUID(), data.method, data.title)
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

  async broadcast(data: Broadcast): Promise<KeychainRequestResponse> {
    return new Promise(async (resolve) => {
      try {
        window.hive_keychain.requestBroadcast(
          data.username,
          typeof data.operations === 'string' ? JSON.parse(data.operations) : data.operations,
          data.method,
          (response: KeychainRequestResponse) => {
            resolve(response)
          }
        )
      } catch (error) {
        throw error
      }
    })
  }

  async signTx(data: SignTx): Promise<KeychainSignTxRequestResponse> {
    return new Promise(async (resolve) => {
      try {
        window.hive_keychain.requestSignTx(data.username, data.tx, data.method, (response: KeychainSignTxRequestResponse) => {
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

  async vote(data: Vote): Promise<KeychainRequestResponse> {
    return new Promise(async (resolve) => {
      try {
        window.hive_keychain.requestVote(
          data.username,
          data.permlink,
          data.author,
          data.weight,
          (response: KeychainRequestResponse) => {
            resolve(response)
          }
        )
      } catch (error) {
        throw error
      }
    })
  }

  async custom(data: Custom): Promise<KeychainRequestResponse> {
    return new Promise(async (resolve) => {
      try {
        window.hive_keychain.requestCustomJson(
          data.username,
          data.id,
          data.method,
          data.json,
          data.display_msg,
          (response: KeychainRequestResponse) => {
            resolve(response)
          }
        )
      } catch (error) {
        throw error
      }
    })
  }

  async transfer(data: Transfer): Promise<KeychainRequestResponse> {
    return new Promise(async (resolve) => {
      try {
        window.hive_keychain.requestTransfer(
          data.username,
          data.to,
          data.amount,
          data.memo,
          data.currency,
          (response: KeychainRequestResponse) => {
            resolve(response)
          },
          data.enforce
        )
      } catch (error) {
        throw error
      }
    })
  }

  async recurrentTransfer(data: RecurrentTransfer): Promise<KeychainRequestResponse> {
    return new Promise(async (resolve) => {
      try {
        window.hive_keychain.requestRecurrentTransfer(
          data.username,
          data.to,
          data.amount,
          data.currency,
          data.memo,
          data.recurrence,
          data.executions,
          (response: KeychainRequestResponse) => {
            resolve(response)
          }
        )
      } catch (error) {
        throw error
      }
    })
  }

  async delegation(data: Delegation): Promise<KeychainRequestResponse> {
    return new Promise(async (resolve) => {
      try {
        window.hive_keychain.requestDelegation(
          data.username,
          data.delegatee,
          data.amount,
          data.unit,
          (response: KeychainRequestResponse) => {
            resolve(response)
          }
        )
      } catch (error) {
        throw error
      }
    })
  }

  async witnessVote(data: WitnessVote): Promise<KeychainRequestResponse> {
    return new Promise(async (resolve) => {
      try {
        window.hive_keychain.requestWitnessVote(data.username, data.witness, data.vote, (response: KeychainRequestResponse) => {
          resolve(response)
        })
      } catch (error) {
        throw error
      }
    })
  }

  async proxy(data: Proxy): Promise<KeychainRequestResponse> {
    return new Promise(async (resolve) => {
      try {
        window.hive_keychain.requestProxy(data.username, data.proxy, (response: KeychainRequestResponse) => {
          resolve(response)
        })
      } catch (error) {
        throw error
      }
    })
  }

  async powerUp(data: PowerUp): Promise<KeychainRequestResponse> {
    return new Promise(async (resolve) => {
      try {
        window.hive_keychain.requestPowerUp(data.username, data.recipient, data.hive, (response: KeychainRequestResponse) => {
          resolve(response)
        })
      } catch (error) {
        throw error
      }
    })
  }

  async powerDown(data: PowerDown): Promise<KeychainRequestResponse> {
    return new Promise(async (resolve) => {
      try {
        window.hive_keychain.requestPowerDown(data.username, data.hive_power, (response: KeychainRequestResponse) => {
          resolve(response)
        })
      } catch (error) {
        throw error
      }
    })
  }

  async updateProposalVote(data: UpdateProposalVote): Promise<KeychainRequestResponse> {
    return new Promise(async (resolve) => {
      try {
        window.hive_keychain.requestUpdateProposalVote(
          data.username,
          data.proposal_ids,
          data.approve,
          data.extensions,
          (response: KeychainRequestResponse) => {
            resolve(response)
          }
        )
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
          memo,
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
