import { LoginProvider, LoginResultError, OperationError } from '../types.js'

export const error = (code: number, message: string): OperationError => {
  return {
    success: false,
    errorCode: code,
    error: message
  }
}

export const loginError = (code: number, message: string, provider?: LoginProvider): LoginResultError => {
  return {
    provider,
    success: false,
    errorCode: code,
    error: message
  }
}
