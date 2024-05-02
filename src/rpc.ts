const DEFAULT_API = 'https://techcoderx.com'

const call = async (method: string, params: any, api: string = DEFAULT_API) => {
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
  const resp = await req.json()
  return resp
}

export const getAccounts = (accounts: string[], api: string = DEFAULT_API) => {
  return call('condenser_api.get_accounts', [accounts], api)
}

export const getDgp = (api: string = DEFAULT_API) => {
  return call('condenser_api.get_dynamic_global_properties', undefined, api)
}

export const hivePerVests = async (api: string = DEFAULT_API) => {
  const dgpResp = await getDgp(api)
  if (dgpResp.error) throw new Error(dgpResp.error)
  return parseFloat(dgpResp.result.total_vesting_fund_hive) / parseFloat(dgpResp.result.total_vesting_shares)
}
