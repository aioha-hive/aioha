import { LoginResultError, OperationError, Providers } from '../types.js'

export const error = (code: number, message: string): OperationError => {
  return {
    success: false,
    errorCode: code,
    error: message
  }
}

export const loginError = (code: number, message: string, provider?: Providers): LoginResultError => {
  return {
    provider,
    success: false,
    errorCode: code,
    error: message
  }
}
