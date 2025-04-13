import { SignedTransaction } from '@hiveio/dhive'
import { AiohaRpcError } from './jsonrpc/eip1193-types.js'

export const DEFAULT_API = 'https://techcoderx.com'
export const FALLBACK_APIS = [
  'https://api.hive.blog',
  'https://api.deathwing.me',
  'https://hive-api.arcange.eu',
  'https://api.openhive.network',
  'https://rpc.mahdiyari.info',
  'https://hive-api.3speak.tv',
  'https://api.c0ff33a.uk',
  'https://anyx.io',
  'https://hiveapi.actifit.io'
]

export const call = async (
  method: string,
  params: any,
  api: string = DEFAULT_API,
  fallbackApis: string[] = FALLBACK_APIS
): Promise<any> => {
  try {
    const req = await fetch(api, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: method,
        params: params
      })
    })
    if (req.status >= 400) {
      if (fallbackApis.length === 0) throw new AiohaRpcError(-32603, 'Failed to fetch')
      return await call(method, params, fallbackApis[0], fallbackApis.slice(1, fallbackApis.length))
    }
    const resp = await req.json()
    return resp
  } catch (e) {
    if (fallbackApis.length === 0) throw new AiohaRpcError(-32603, 'Failed to fetch')
    console.warn(`There was an error fetching ${method} via ${api}:`, error);
      return await call(method, params, fallbackApis[0], fallbackApis.slice(1, fallbackApis.length))
  }
}

export const callRest = async <T>(
  method: string,
  api: string = DEFAULT_API,
  fallbackApis: string[] = FALLBACK_APIS
): Promise<T> => {
  const req = await fetch(api + method)
  if (req.status >= 400) {
    if (fallbackApis.length === 0) throw new AiohaRpcError(-32603, 'Failed to fetch')
    return await callRest(method, fallbackApis[0], fallbackApis.slice(1, fallbackApis.length))
  }
  const resp: T = await req.json()
  return resp
}

export const getAccounts = (accounts: string[], api: string = DEFAULT_API) => {
  return call('condenser_api.get_accounts', [accounts], api)
}

export const getAccountsErrored = (rpcResponse: any): boolean => {
  return !!rpcResponse.error || !Array.isArray(rpcResponse.result) || rpcResponse.result.length === 0
}

export const getDgp = (api: string = DEFAULT_API) => {
  return call('condenser_api.get_dynamic_global_properties', undefined, api)
}

export const getKeyRefs = (keys: string[], api: string = DEFAULT_API) => {
  return call(
    'account_by_key_api.get_key_references',
    {
      keys: keys
    },
    api
  )
}

export const hivePerVests = async (api: string = DEFAULT_API) => {
  const dgpResp = await getDgp(api)
  if (dgpResp.error) throw new Error(dgpResp.error)
  return parseFloat(dgpResp.result.total_vesting_fund_hive) / parseFloat(dgpResp.result.total_vesting_shares)
}

export const broadcastTx = (tx: SignedTransaction, api: string = DEFAULT_API) => {
  return call('condenser_api.broadcast_transaction', [tx], api)
}
