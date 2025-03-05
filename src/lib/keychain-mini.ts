import {
  AddAccountAuthority,
  AddKeyAuthority,
  RemoveAccountAuthority,
  RemoveKeyAuthority,
  Broadcast,
  Custom,
  Decode,
  Delegation,
  Login,
  Post,
  PowerDown,
  PowerUp,
  Proxy,
  RecurrentTransfer,
  SignBuffer,
  SignTx,
  Transfer,
  UpdateProposalVote,
  Vote,
  WitnessVote,
  Encode,
  EncodeWithKeys
} from 'keychain-sdk/dist/interfaces/keychain-sdk.interface'
import { KeychainRequestResponse, KeychainSignTxRequestResponse } from 'keychain-sdk/dist/interfaces/keychain.interface'

/**
 * Stripped version of keychain-sdk.
 */
export class KeychainMini {
  async isKeychainInstalled(): Promise<boolean> {
    return new Promise((resolve) => {
      if (window.hive_keychain) {
        try {
          window.hive_keychain.requestHandshake(() => resolve(true))
        } catch {
          resolve(false)
        }
      } else {
        resolve(false)
      }
    })
  }

  static isKeychainInstalledSync(): boolean {
    return !!window.hive_keychain
  }

  async login(data: Login): Promise<any> {
    return await this.signBuffer({
      username: data.username,
      message: data.message ?? window.crypto.randomUUID(),
      method: data.method,
      title: data.title
    })
  }

  async encode(data: Encode): Promise<KeychainRequestResponse> {
    return new Promise(async (resolve) => {
      try {
        await this.isKeychainInstalled()
        window.hive_keychain.requestEncodeMessage(
          data.username,
          data.receiver,
          data.message,
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

  async encodeWithKeys(data: EncodeWithKeys): Promise<KeychainRequestResponse> {
    return new Promise(async (resolve) => {
      try {
        await this.isKeychainInstalled()
        window.hive_keychain.requestEncodeWithKeys(
          data.username,
          data.publicKeys,
          data.message,
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

  async decode(data: Decode): Promise<KeychainRequestResponse> {
    return new Promise(async (resolve) => {
      try {
        await this.isKeychainInstalled()
        window.hive_keychain.requestVerifyKey(data.username, data.message, data.method, (response: KeychainRequestResponse) => {
          resolve(response)
        })
      } catch (error) {
        throw error
      }
    })
  }

  async signBuffer(data: SignBuffer): Promise<KeychainRequestResponse> {
    return new Promise(async (resolve) => {
      try {
        await this.isKeychainInstalled()
        window.hive_keychain.requestSignBuffer(
          data.username,
          data.message,
          data.method,
          (response: KeychainRequestResponse) => {
            resolve(response)
          },
          undefined,
          data.title
        )
      } catch (error) {
        throw error
      }
    })
  }

  async addAccountAuthority(data: AddAccountAuthority): Promise<KeychainRequestResponse> {
    return new Promise(async (resolve) => {
      try {
        await this.isKeychainInstalled()
        window.hive_keychain.requestAddAccountAuthority(
          data.username,
          data.authorizedUsername,
          data.role,
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

  async removeAccountAuthority(data: RemoveAccountAuthority): Promise<KeychainRequestResponse> {
    return new Promise(async (resolve) => {
      try {
        await this.isKeychainInstalled()
        window.hive_keychain.requestRemoveAccountAuthority(
          data.username,
          data.authorizedUsername,
          data.role,
          (response: KeychainRequestResponse) => {
            resolve(response)
          }
        )
      } catch (error) {
        throw error
      }
    })
  }

  async addKeyAuthority(data: AddKeyAuthority): Promise<KeychainRequestResponse> {
    return new Promise(async (resolve) => {
      try {
        await this.isKeychainInstalled()
        window.hive_keychain.requestAddKeyAuthority(
          data.username,
          data.authorizedKey,
          data.role,
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

  async removeKeyAuthority(data: RemoveKeyAuthority): Promise<KeychainRequestResponse> {
    return new Promise(async (resolve) => {
      try {
        await this.isKeychainInstalled()
        window.hive_keychain.requestRemoveKeyAuthority(
          data.username,
          data.authorizedKey,
          data.role,
          (response: KeychainRequestResponse) => {
            resolve(response)
          }
        )
      } catch (error) {
        throw error
      }
    })
  }

  async broadcast(data: Broadcast): Promise<KeychainRequestResponse> {
    return new Promise(async (resolve) => {
      try {
        await this.isKeychainInstalled()
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
        await this.isKeychainInstalled()
        window.hive_keychain.requestSignTx(data.username, data.tx, data.method, (response: KeychainSignTxRequestResponse) => {
          resolve(response)
        })
      } catch (error) {
        throw error
      }
    })
  }

  async post(data: Post): Promise<KeychainRequestResponse> {
    return new Promise(async (resolve) => {
      try {
        await this.isKeychainInstalled()
        window.hive_keychain.requestPost(
          data.username,
          data.title,
          data.body,
          data.parent_perm,
          data.parent_username,
          data.json_metadata,
          data.permlink,
          data.comment_options,
          (response: KeychainRequestResponse) => {
            resolve(response)
          }
        )
      } catch (error) {
        throw error
      }
    })
  }

  async vote(data: Vote): Promise<KeychainRequestResponse> {
    return new Promise(async (resolve) => {
      try {
        await this.isKeychainInstalled()
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
        await this.isKeychainInstalled()
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
        await this.isKeychainInstalled()
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
        await this.isKeychainInstalled()
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
        await this.isKeychainInstalled()
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
        await this.isKeychainInstalled()
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
        await this.isKeychainInstalled()
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
        await this.isKeychainInstalled()
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
        await this.isKeychainInstalled()
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
        await this.isKeychainInstalled()
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
}
