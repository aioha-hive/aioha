import type { Transaction, Operation, SignedTransaction } from '@hiveio/dhive'
import {
  LoginOptions,
  LoginResult,
  PersistentLogin,
  KeyTypes,
  OperationResult,
  OperationResultObj,
  SignOperationResultObj,
  SignOperationResult,
  AccountDiscStream,
  DiscoverOptions,
  Providers,
  PersistentLoginMetamaskSnap,
  LoginResultError,
  SignOperationResultObjHF26,
  AccountAuths
} from '../types.js'
import { AiohaProviderBase } from './provider.js'
import type { MetaMaskInpageProvider, RequestArguments } from '@metamask/providers'
import { getSnapsProvider } from '../lib/metamask.js'
import { SimpleEventEmitter } from '../lib/event-emitter.js'
import { HF26Operation, HF26SignedTransaction, HF26Transaction } from '../lib/hf26-types.js'
import { AiohaRpcError } from '../jsonrpc/eip1193-types.js'
import { broadcastTxHF26, callRest, getKeyRefs } from '../rpc.js'
import { oldToHF26Operation, oldToHF26Tx } from '../lib/hf26-adapter.js'
import { constructTxHeader } from '../opbuilder.js'
import { error, loginError } from '../lib/errors.js'

type SnapData = {
  permissionName: string
  id: string
  version: string
  initialPermissions: Record<string, unknown>
}
type SnapResponse = Record<string, SnapData>
interface SnapResponsePublicKeys {
  publicKeys: {
    accountIndex: number
    accounts?: string[]
    publicKey: string
    role: KeyTypes
  }[]
}
interface SnapResponseMemo {
  buffer: string
}
interface SnapResponseSign {
  signatures: string[]
}

const SNAP_ORIGIN = `npm:@hiveio/metamask-snap`
const SNAP_VERSION = '1.6.0'

const SNAP_NOT_CONNECTED_ERR = error(4900, 'Snap is not connected')

export class MetaMaskSnap extends AiohaProviderBase {
  private snap?: SnapData
  private provider?: MetaMaskInpageProvider
  private accountIdx?: number
  private username?: string

  constructor(api: string, emitter: SimpleEventEmitter) {
    super(api, emitter)
  }

  /**
   * Initializes the provider, usually injected in window.ethereum.
   * @returns Boolean of whether Metamask is installed with snaps capabilities.
   */
  async initProvider(): Promise<boolean> {
    if (!this.provider) {
      const provider = await getSnapsProvider()
      if (!provider) {
        return false
      }
      this.provider = provider
    }
    return true
  }

  /**
   * Initialize the Hive snap.
   * @returns Boolean of whether the snap is connected.
   */
  private async initSnap(): Promise<boolean> {
    if (!(await this.initProvider())) return false
    if (!this.snap) {
      try {
        let snaps = (await this.provider!.request({ method: 'wallet_getSnaps' })) as SnapResponse
        if (!snaps[SNAP_ORIGIN]) {
          snaps = (await this.provider!.request({
            method: 'wallet_requestSnaps',
            params: {
              [SNAP_ORIGIN]: {
                version: SNAP_VERSION
              }
            }
          })) as SnapResponse
        }
        this.snap = snaps[SNAP_ORIGIN]
      } catch {
        return false
      }
    }
    return !!this.snap
  }

  private async invokeSnap(method: RequestArguments['method'], params?: RequestArguments['params']) {
    if (!this.snap) throw new AiohaRpcError(5001, 'The snap is not connected')

    return this.provider!.request({
      method: 'wallet_invokeSnap',
      params: {
        snapId: SNAP_ORIGIN,
        request: params ? { method, params } : { method }
      }
    })
  }

  /**
   * Determine if Metamask provider is installed. This should be called after `initProvider()`.
   */
  isInstalled() {
    return !!this.provider
  }

  private async checkAssociation(username: string, keyType: KeyTypes, accIdx: number): Promise<LoginResultError | undefined> {
    const result = await this.discoverAccounts(undefined, {
      accountIndex: accIdx,
      roles: [keyType]
    })
    if (!result.success) {
      return {
        provider: Providers.MetaMaskSnap,
        ...result
      }
    }
    const foundAccounts = result.result as SnapResponsePublicKeys['publicKeys']
    if (foundAccounts.length === 0 || !foundAccounts[0].accounts || !foundAccounts[0].accounts.includes(username)) {
      return loginError(5901, 'Username is not associated with the snap', Providers.MetaMaskSnap)
    }
  }

  async login(username: string, options: LoginOptions): Promise<LoginResult> {
    if (!(await this.initSnap())) return SNAP_NOT_CONNECTED_ERR
    const accIdx = options?.metamask?.accountIdx ?? 0
    if (options.metamask && options.metamask.validateUser) {
      const check = await this.checkAssociation(username, options.keyType!, accIdx)
      if (!!check) return check
    }
    this.accountIdx = accIdx
    this.username = username
    localStorage.setItem('mmHiveSnapAccIdx', accIdx.toString())
    return {
      provider: Providers.MetaMaskSnap,
      success: true,
      username,
      result: ''
    }
  }

  async loginAndDecryptMemo(username: string, options: LoginOptions): Promise<LoginResult> {
    if (!(await this.initSnap())) return SNAP_NOT_CONNECTED_ERR
    const accIdx = options?.metamask?.accountIdx ?? 0
    if (options.metamask && options.metamask.validateUser) {
      const check = await this.checkAssociation(username, options.keyType!, accIdx)
      if (!!check) return check
    }
    const decoded = await this.decryptMemo(options.msg!, options.keyType!)
    if (!decoded.success) return decoded
    this.accountIdx = accIdx
    this.username = username
    localStorage.setItem('mmHiveSnapAccIdx', accIdx.toString())
    return {
      provider: Providers.MetaMaskSnap,
      success: true,
      username,
      result: decoded.result
    }
  }

  async logout(): Promise<void> {
    delete this.accountIdx
    delete this.username
    localStorage.removeItem('mmHiveSnapAccIdx')
  }

  async discoverAccounts(stream?: AccountDiscStream, options?: DiscoverOptions): Promise<OperationResultObj> {
    if (!(await this.initSnap())) return SNAP_NOT_CONNECTED_ERR
    try {
      const roles =
        !options || !Array.isArray(options.roles) || options.roles.length === 0
          ? [KeyTypes.Owner, KeyTypes.Active, KeyTypes.Posting]
          : options.roles
      const accIdx = options?.accountIndex ?? 0
      const response = (await this.invokeSnap('hive_getPublicKeys', {
        keys: roles.map((role) => ({ role, accountIndex: accIdx }))
      })) as SnapResponsePublicKeys
      const accounts = await getKeyRefs(
        response.publicKeys.map((k) => k.publicKey),
        this.api
      )
      if (!accounts.error && accounts.result && Array.isArray(accounts.result.accounts)) {
        for (let i in response.publicKeys) {
          response.publicKeys[i].accounts = accounts.result.accounts[i]
          if (typeof stream === 'function')
            response.publicKeys[i].accounts!.forEach((u) => {
              stream(
                {
                  username: u,
                  index: accIdx,
                  pubkey: response.publicKeys[i].publicKey,
                  role: response.publicKeys[i].role
                },
                () => {}
              )
            })
        }
      }
      return {
        success: true,
        result: response.publicKeys
      }
    } catch (e: any) {
      return error(5902, e.message)
    }
  }

  loadAuth(username: string): boolean {
    const idx = parseInt(localStorage.getItem('mmHiveSnapAccIdx') || '')
    if (isNaN(idx)) return false
    this.accountIdx = idx
    this.username = username
    return true
  }

  getUser(): string | undefined {
    return this.username
  }

  getLoginInfo(): PersistentLogin | undefined {
    return {
      provider: Providers.MetaMaskSnap,
      accIdx: this.accountIdx
    }
  }

  loadLogin(username: string, info: PersistentLogin): boolean {
    const idx = (info as PersistentLoginMetamaskSnap).accIdx
    localStorage.setItem('mmHiveSnapAccIdx', idx.toString())
    return this.loadAuth(username)
  }

  async encryptMemo(message: string, keyType: KeyTypes, recipient: string): Promise<OperationResult> {
    try {
      const auths = await callRest<AccountAuths>(`/hafbe-api/accounts/${recipient}/authority`)
      if (!auths[keyType]) throw ''
      const key = keyType === KeyTypes.Memo ? auths.memo : auths[keyType].key_auths[0][0]
      const encoded = await this.encryptMemoWithKeys(message, keyType, [key])
      if (!encoded.success) return encoded
      return {
        success: true,
        result: Object.values(encoded.result)[0]
      }
    } catch {
      return error(5000, 'Failed to encrypt memo')
    }
  }

  async encryptMemoWithKeys(message: string, keyType: KeyTypes, recipientKeys: string[]): Promise<OperationResultObj> {
    if (!(await this.initSnap())) return SNAP_NOT_CONNECTED_ERR
    const results: { [key: string]: string } = {}
    try {
      for (let k in recipientKeys) {
        const response = (await this.invokeSnap('hive_encrypt', {
          buffer: message,
          firstKey: { role: keyType, accountIndex: this.accountIdx },
          secondKey: recipientKeys[k]
        })) as SnapResponseMemo
        results[recipientKeys[k]] = response.buffer
      }
    } catch (e: any) {
      return error(e.code, e.message)
    }
    return {
      success: true,
      result: results
    }
  }

  async decryptMemo(memo: string, keyType: KeyTypes): Promise<OperationResult> {
    try {
      const response = (await this.invokeSnap('hive_decrypt', {
        buffer: memo,
        firstKey: { role: keyType, accountIndex: this.accountIdx }
      })) as SnapResponseMemo
      return {
        success: true,
        result: response.buffer
      }
    } catch (e: any) {
      return error(e.code, e.message)
    }
  }

  async signMessage(message: string, keyType: KeyTypes): Promise<OperationResult> {
    return error(4200, 'message signing is unsupported in the MetaMask snap')
  }

  async signTx(tx: Transaction, keyType: KeyTypes): Promise<SignOperationResultObj> {
    const signed = await this.signTxHF26(oldToHF26Tx(tx), keyType)
    if (!signed.success) return signed
    const result = structuredClone(tx) as SignedTransaction
    result.signatures = signed.result.signatures
    return {
      success: true,
      result
    }
  }

  async signAndBroadcastTx(tx: Operation[], keyType: KeyTypes): Promise<SignOperationResult> {
    return await this.signAndBroadcastTxHF26(
      tx.map((t) => oldToHF26Operation(t)),
      keyType
    )
  }

  async signTxHF26(tx: HF26Transaction, keyType: KeyTypes): Promise<SignOperationResultObjHF26> {
    try {
      if (!(await this.initSnap())) return SNAP_NOT_CONNECTED_ERR
      const response = (await this.invokeSnap('hive_signTransaction', {
        transaction: JSON.stringify(tx),
        keys: [{ role: keyType, accountIndex: this.accountIdx }]
      })) as SnapResponseSign
      const result = structuredClone(tx) as HF26SignedTransaction
      result.signatures = response.signatures
      return {
        success: true,
        result
      }
    } catch (e: any) {
      return error(e.code, e.message)
    }
  }

  async signAndBroadcastTxHF26(tx: HF26Operation[], keyType: KeyTypes): Promise<SignOperationResult> {
    try {
      const unsignedTx = (await constructTxHeader(tx, this.api)) as HF26Transaction
      const signedTx = await this.signTxHF26(unsignedTx, keyType)
      if (!signedTx.success) return signedTx
      const { transactionDigest } = await import(/* webpackChunkName: 'tx-digest' */ '@aioha/tx-digest')
      const txId = (await transactionDigest(unsignedTx)).txId
      const broadcasted = await broadcastTxHF26(signedTx.result, this.api)
      if (broadcasted.error)
        return error(
          broadcasted.error.code ?? -32603,
          broadcasted.error.message ?? 'Failed to broadcast transaction due to unknown error'
        )
      else
        return {
          success: true,
          result: txId
        }
    } catch (e: any) {
      return error(5000, 'Failed to sign or broadcast tx due to unknown error')
    }
  }
}
