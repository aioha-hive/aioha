import type { Transaction } from '@hiveio/dhive'
import type { AiohaProviderBase } from '../providers/provider.js'
import type { KeyTypes, OperationResult, OperationResultObj, SignOperationResult, SignOperationResultObj } from '../types.js'
import { AiohaRpcError } from './eip1193-types.js'
import { AiohaExtension } from './methods.js'

interface KeyTypeRole {
  role: KeyTypes
}

interface SignTxParams {
  transaction: Transaction
  keys: KeyTypeRole[]
}

interface DecryptParams {
  buffer: string
  firstKey: KeyTypeRole
}

interface EncryptParams extends DecryptParams {
  secondKey: string
}

const methods: {
  [method: string]: (
    core: AiohaProviderBase,
    params: any
  ) => Promise<OperationResult | OperationResultObj | SignOperationResult | SignOperationResultObj>
} = {
  encrypt: (core: AiohaProviderBase, params: EncryptParams): Promise<OperationResultObj> => {
    return core.encryptMemoWithKeys(params.buffer, params.firstKey.role, [params.secondKey])
  },
  decrypt: (core: AiohaProviderBase, params: DecryptParams): Promise<OperationResult> => {
    return core.decryptMemo(params.buffer, params.firstKey.role)
  },
  signTransaction: async (core: AiohaProviderBase, params: SignTxParams): Promise<SignOperationResultObj> => {
    if (!Array.isArray(params.keys) || params.keys.length === 0) {
      throw new AiohaRpcError(5003, 'keys must be a non-empty array')
    }
    return await core.signTx(params.transaction, params.keys[0].role)
  }
}

/**
 * Alternative core RPC extension following hive_ prefixed methods
 * https://peakd.com/hive-139531/@thebeedevs/further-integration-of-metamask-and-hive-wallet
 */
export const Core2: AiohaExtension = {
  name: 'Core2',
  isValidMethod: (method: string) => {
    return typeof methods[method] === 'function'
  },
  isAuthRequired: () => {
    return true
  },
  isLoginMethod: () => {
    return false
  },
  isLogoutMethod: () => {
    return false
  },
  getMethodPrefix: () => {
    return 'hive_'
  },
  request: async (core: AiohaProviderBase, method: string, params) => {
    if (Core2.isValidMethod(method)) {
      const result = await methods[method](core, params)
      if (!result.success) {
        throw new AiohaRpcError(result.errorCode, result.error)
      } else {
        return result.result
      }
    }
  }
}
