import type { IOnlineEncryptionProvider, IOnlineSignatureProvider, ITransaction, TPublicKey, TRole } from '@hiveio/wax'
import type { Aioha } from '../index.js'
import { AiohaRpcError } from '../jsonrpc/eip1193-types.js'
import { KeyTypes, Providers } from '../types.js'

const mapRoles: Record<TRole, KeyTypes | undefined> = {
  active: KeyTypes.Active,
  posting: KeyTypes.Posting,
  owner: undefined,
  memo: KeyTypes.Memo
}

/**
 * Wax transaction signature provider using Aioha.
 *
 * @example
 * ```
 * import { initAioha, WaxAiohaSigner } from '@aioha/aioha'
 *
 * const aioha = initAioha()
 * const provider = WaxAiohaSigner.for(aioha, "active");
 *
 * // Create a transaction using the Wax Hive chain instance
 * const tx = await chain.createTransaction();
 *
 * // Perform some operations, e.g. pushing operations...
 *
 * // Sign the transaction
 * await provider.signTransaction(tx)
 *
 * // Broadcast
 * await chain.broadcast(tx);
 *
 * // Log tx id
 * console.log(tx.id)
 * ```
 */
export class WaxAiohaSigner implements IOnlineSignatureProvider, IOnlineEncryptionProvider {
  private readonly role: KeyTypes
  private readonly aioha: Aioha

  private constructor(aioha: Aioha, role: TRole) {
    if (!mapRoles[role]) throw new Error(`Role ${role} is unsupported`)

    this.aioha = aioha
    this.role = mapRoles[role]
  }

  public static for(aioha: Aioha, role: TRole): WaxAiohaSigner {
    return new WaxAiohaSigner(aioha, role)
  }

  public async signTransaction(transaction: ITransaction): Promise<void> {
    transaction.performOperationEncryption(this)

    const signed =
      this.aioha.getCurrentProvider() === Providers.MetaMaskSnap
        ? await this.aioha.signTxHF26(JSON.parse(transaction.toApi()), this.role)
        : await this.aioha.signTx(JSON.parse(transaction.toLegacyApi()), this.role)
    if (!signed.success) throw new AiohaRpcError(signed.errorCode, signed.error)
    for (const sig of signed.result.signatures) transaction.addSignature(sig)
  }

  public async encryptData(buffer: string, recipient: TPublicKey): Promise<string> {
    const result = await this.aioha.encryptMemoWithKeys(buffer.startsWith('#') ? buffer : `#${buffer}`, KeyTypes.Memo, [
      recipient
    ])
    if (!result.success) throw new AiohaRpcError(result.errorCode, result.error)
    return Object.values(result.result)[0] as string
  }

  public async decryptData(buffer: string): Promise<string> {
    const result = await this.aioha.decryptMemo(buffer, KeyTypes.Memo)
    if (!result.success) throw new AiohaRpcError(result.errorCode, result.error)
    return result.result
  }
}
