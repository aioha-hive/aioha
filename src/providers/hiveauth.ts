import { Auth } from '../lib/hiveauth-wrapper.js'
import { AiohaProvider, HiveAuthOptions } from '../types.js'

export class HiveAuth extends AiohaProvider {
  constructor(options: HiveAuthOptions) {
    super()
    this.provider = new Auth(options.username)
  }
}
