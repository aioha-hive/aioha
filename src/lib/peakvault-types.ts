export interface VaultResponse {
  success: boolean
  account: string
  error?: string
  result?: string
  publicKey?: string
}

export interface VaultBroadcastResponse {
  success: boolean
  account: string
  error?: string
  result?: {
    status: string
    tx_id: string
  }
  publicKey?: string
}

export interface VaultError {
  success: false
  account: string
  error: string
  message: string
}
