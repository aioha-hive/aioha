import type { IOnlineSignatureProvider, ITransaction, TRole } from '@hiveio/wax'
import type { Aioha } from '../index.js'
import { AiohaRpcError } from '../jsonrpc/eip1193-types.js'
import { KeyTypes } from '../types.js'

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
 * import { initAioha } from '@aioha/aioha'
 *
 * const aioha = initAioha()
 * const provider = WaxAiohaProvider.for(aioha, "active");
 *
 * // Create a transaction using the Wax Hive chain instance
 * const tx = await chain.createTransaction();
 *
 * // Perform some operations, e.g. pushing operations...
 *
 * // Sign the transaction
 * await tx.sign(provider);
 *
 * // Broadcast
 * await chain.broadcast(tx);
 *
 * // Log tx id
 * console.log(tx.id)
 * ```
 */
export class WaxAiohaProvider implements IOnlineSignatureProvider {
  private readonly role: KeyTypes
  private readonly aioha: Aioha

  private constructor(aioha: Aioha, role: TRole) {
    if (!mapRoles[role]) throw new Error(`Role ${role} is not supported by the Wax signature provider: ${WaxAiohaProvider.name}`)

    this.aioha = aioha

    this.role = mapRoles[role]
  }

  public static for(aioha: Aioha, role: TRole): WaxAiohaProvider {
    return new WaxAiohaProvider(aioha, role)
  }

  public async signTransaction(transaction: ITransaction): Promise<void> {
    // TODO: move away from legacy serialization
    const legacyTx = JSON.parse(transaction.toLegacyApi())
    const signed = await this.aioha.signTx(legacyTx, this.role)
    if (!signed.success) throw new AiohaRpcError(signed.errorCode, signed.error)
    for (const sig of signed.result.signatures) transaction.sign(sig)
  }
}
