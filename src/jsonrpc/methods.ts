import type { AiohaProviderBase } from '../providers/provider.js'
import type { LoginResult, OperationResult, SignOperationResult, LoginResultSuccess, OperationSuccess } from '../types.js'
import type { Login, MessageKeyType, SignBroadcastTx, SignTx } from './param-types.js'
import { AiohaRpcError } from './eip1193-types.js'

export interface AiohaExtension {
  isValidMethod: (method: string) => boolean
  isAuthRequired: (method: string) => boolean
  isLoginMethod: (method: string) => boolean
  isLogoutMethod: (method: string) => boolean
  getMethodPrefix: () => string
  request: (core: AiohaProviderBase, method: string, params: any) => Promise<any>
}

const CoreRpcMethods: {
  [method: string]: (core: AiohaProviderBase, params: any) => Promise<LoginResult | OperationResult | SignOperationResult>
} = {
  login: (core: AiohaProviderBase, params: Login): Promise<LoginResult> => {
    return core.login(params.username, {
      msg: params.message,
      keyType: params.key_type
    })
  },
  login_memo: (core: AiohaProviderBase, params: Login): Promise<LoginResult> => {
    return core.loginAndDecryptMemo(params.username, {
      msg: params.message,
      keyType: params.key_type
    })
  },
  logout: async (core: AiohaProviderBase): Promise<OperationResult> => {
    await core.logout()
    return {
      success: true,
      result: ''
    }
  },
  decrypt_memo: (core: AiohaProviderBase, params: MessageKeyType): Promise<OperationResult> => {
    return core.decryptMemo(params.message, params.key_type)
  },
  sign_message: (core: AiohaProviderBase, params: MessageKeyType): Promise<OperationResult> => {
    return core.signMessage(params.message, params.key_type)
  },
  sign_tx: (core: AiohaProviderBase, params: SignTx): Promise<OperationResult> => {
    return core.signTx(params.tx, params.key_type)
  },
  sign_and_broadcast_tx: (core: AiohaProviderBase, params: SignBroadcastTx): Promise<SignOperationResult> => {
    return core.signAndBroadcastTx(params.ops, params.key_type)
  }
}

export const CoreRpc: AiohaExtension = {
  isValidMethod: (method: string) => {
    return typeof CoreRpcMethods[method] === 'function'
  },
  isAuthRequired: (method: string) => {
    return method !== 'login' && method !== 'login_memo'
  },
  isLoginMethod: (method: string) => {
    return method === 'login' || method === 'login_memo'
  },
  isLogoutMethod: (method: string) => {
    return method === 'logout'
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
        if (CoreRpc.isLoginMethod(method)) {
          const loginResult = result as LoginResultSuccess
          return {
            provider: loginResult.provider,
            result: loginResult.result,
            username: loginResult.username,
            public_key: loginResult.publicKey
          }
        } else if (method === 'sign_message') {
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
