import type { Aioha } from '../index.js'
import { AiohaRpcError, RequestArguments } from '../jsonrpc/eip1193-types.js'
import { AiohaExtension, CoreRpc } from '../jsonrpc/methods.js'
import { IsProviderRegistered } from '../jsonrpc/param-types.js'
import { Events, OperationError } from '../types.js'
import { call } from '../rpc.js'

const notLoggedInResult: OperationError = {
  success: false,
  errorCode: 4900,
  error: 'Not logged in'
}

const CoreRpcGetters: {
  [method: string]: (core: Aioha, params?: any) => any
} = {
  get_registered_providers: (core: Aioha) => core.getProviders(),
  get_current_provider: (core: Aioha) => core.getCurrentProvider(),
  get_current_user: (core: Aioha) => core.getCurrentUser(),
  get_public_key: (core: Aioha) => core.getPublicKey(),
  is_logged_in: (core: Aioha) => core.isLoggedIn(),
  is_provider_registered: (core: Aioha, params: IsProviderRegistered) =>
    params.enabled ? core.isProviderEnabled(params.provider) : core.isProviderRegistered(params.provider)
}

export class AiohaJsonRpc {
  private readonly aioha: Aioha
  private extensions: AiohaExtension[]

  constructor(aioha: Aioha) {
    this.aioha = aioha
    this.extensions = [CoreRpc]
  }

  registerExtension(extension: AiohaExtension) {
    this.extensions.push(extension)
  }

  /**
   * List all registered extension names.
   * @returns List of extension names
   */
  listExtensions() {
    return this.extensions.map((e) => e.name)
  }

  /**
   * JSON-RPC request.
   *
   * See [docs](https://aioha.dev/docs/core/jsonrpc) for Aioha RPC methods.
   * @param {RequestArguments} args JSON-RPC call body
   * @returns RPC call result
   */
  async request(args: RequestArguments): Promise<unknown> {
    // 0. pre-validation
    if (typeof args !== 'object' || typeof args.method !== 'string' || (args.params && typeof args.params !== 'object'))
      return Promise.reject(new AiohaRpcError(-32600, 'Invalid request'))

    // 1. Provider specific methods
    if (this.aioha.isLoggedIn()) {
      try {
        const result = await this.aioha.getPI().request(args)
        return result
      } catch (e: any) {
        if (e.name !== 'AiohaRpcError' || e.code !== 4200) throw e
      }
    }

    // 2. aioha_api.* getter methods
    if (args.method.startsWith('aioha_api.')) {
      const submethod = args.method.replace('aioha_api.', '')
      if (typeof CoreRpcGetters[submethod] === 'function') {
        return CoreRpcGetters[submethod](this.aioha, args.params)
      }
    }

    // 3. Extensions
    for (const ext in this.extensions) {
      const submethod = args.method.replace(this.extensions[ext].getMethodPrefix(), '')
      if (this.extensions[ext].isValidMethod(submethod)) {
        if (this.extensions[ext].isAuthRequired(submethod) && !this.aioha.isLoggedIn())
          throw new AiohaRpcError(notLoggedInResult.errorCode, notLoggedInResult.error)
        else {
          const result = await this.extensions[ext].request(this.aioha.getPI(), submethod, args.params)
          return result
        }
      }
    }

    // 4. Hive API call
    const apis = this.aioha.getApi()
    const apiRequest = await call(args.method, args.params, apis[0], apis.slice(1))
    if (apiRequest.error) throw new Error(apiRequest.error)
    else return apiRequest.result
  }

  // Event emitters
  on(eventName: Events, listener: Function) {
    this.aioha.on(eventName, listener)
    return this
  }
  once(eventName: Events, listener: Function) {
    this.aioha.once(eventName, listener)
    return this
  }
  off(eventName: Events, listener?: Function) {
    this.aioha.off(eventName, listener)
    return this
  }
}
