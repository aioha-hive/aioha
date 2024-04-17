import { KeychainSDK } from 'keychain-sdk'
import { AiohaProvider } from '../types.js'

export class Keychain extends AiohaProvider {
  constructor() {
    super()
    this.provider = new KeychainSDK(window)
  }
}
