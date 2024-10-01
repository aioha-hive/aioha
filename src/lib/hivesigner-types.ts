export interface HiveSignerError {
  error: 'unauthorized_client' | 'unauthorized_access' | 'invalid_grant' | 'invalid_scope' | 'server_error'
  error_description: string
}

export type CallbackFunction = (error: any, response: any) => any

export interface ClientConfig {
  apiURL?: string
  app: string
  callbackURL: string
  scope?: string[]
  responseType?: 'code'
  accessToken?: string
}

export interface SendResponse {
  memoDecoded?: string
  result: {
    id: string
  }
}
