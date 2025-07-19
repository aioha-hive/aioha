import type { AiohaProviderBase } from '../providers/provider.js'
import type { OperationResult, SignOperationResult, OperationSuccess, SignOperationResultObj } from '../types.js'
import type { MessageKeyType, SignBroadcastTx, SignTx } from './param-types.js'
import { AiohaRpcError } from './eip1193-types.js'

export interface AiohaExtension {
  name: string
  isValidMethod: (method: string) => boolean
  isAuthRequired: (method: string) => boolean
  getMethodPrefix: () => string
  request: (core: AiohaProviderBase, method: string, params: any) => Promise<any>
}

const CoreRpcMethods: {
  [method: string]: (
    core: AiohaProviderBase,
    params: any
  ) => Promise<OperationResult | SignOperationResult | SignOperationResultObj>
} = {
  decrypt_memo: (core: AiohaProviderBase, params: MessageKeyType): Promise<OperationResult> => {
    return core.decryptMemo(params.message, params.key_type)
  },
  sign_message: (core: AiohaProviderBase, params: MessageKeyType): Promise<OperationResult> => {
    return core.signMessage(params.message, params.key_type)
  },
  sign_tx: (core: AiohaProviderBase, params: SignTx): Promise<SignOperationResultObj> => {
    return core.signTx(params.tx, params.key_type)
  },
  sign_and_broadcast_tx: (core: AiohaProviderBase, params: SignBroadcastTx): Promise<SignOperationResult> => {
    return core.signAndBroadcastTx(params.ops, params.key_type)
  }
}

export const CoreRpc: AiohaExtension = {
  name: 'Core',
  isValidMethod: (method: string) => {
    return typeof CoreRpcMethods[method] === 'function'
  },
  isAuthRequired: (method: string) => {
    return method !== 'login' && method !== 'login_memo'
  },
  getMethodPrefix: () => {
    return 'aioha_api.'
  },
  request: async (core: AiohaProviderBase, method: string, params) => {
    if (CoreRpc.isValidMethod(method)) {
      const result = await CoreRpcMethods[method](core, params)
      if (!result.success) {
        throw new AiohaRpcError(result.errorCode, result.error)
      } else {
        if (method === 'sign_message') {
          const signResult = result as OperationSuccess
          return {
            signature: signResult.result,
            public_key: signResult.publicKey
          }
        } else return result.result
      }
    }
  }
}
