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

export const UNK_BC_ERROR = 'Failed to broadcast transaction due to unknown error'
export const UNK_SBC_ERROR = 'Failed to sign or broadcast tx due to unknown error'