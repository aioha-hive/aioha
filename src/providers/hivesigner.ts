import hivesigner from 'hivesigner'
import { ClientConfig } from 'hivesigner/lib/types/client-config.interface.js'
import { AiohaProvider } from '../types.js'

export class HiveSigner extends AiohaProvider {
  constructor(options: ClientConfig) {
    super()
    this.provider = new hivesigner.Client(options)
  }
}
