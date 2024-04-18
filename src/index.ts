import { HiveAuth } from './providers/hiveauth.js'
import { HiveSigner } from './providers/hivesigner.js'
import { Keychain } from './providers/keychain.js'
import { ClientConfig as HiveSignerOptions } from 'hivesigner/lib/types/client-config.interface.js'
import { HiveAuthOptions } from './types.js'

export class Aioha {
  providers: {
    keychain?: Keychain
    hivesigner?: HiveSigner
    hiveauth?: HiveAuth
  }

  constructor() {
    this.providers = {}
  }

  registerKeychain() {
    this.providers.keychain = new Keychain()
  }

  registerHiveSigner(options: HiveSignerOptions) {
    this.providers.hivesigner = new HiveSigner(options)
  }

  registerHiveAuth(options: HiveAuthOptions) {
    this.providers.hiveauth = new HiveAuth(options)
  }

  /**
   * Get list of registered providers
   * @returns string[]
   */
  getProviders() {
    return Object.keys(this.providers)
  }
}
