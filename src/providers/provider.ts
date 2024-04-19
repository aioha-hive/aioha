import { LoginOptions, LoginResult } from '../types'

export abstract class AiohaProvider {
  protected provider: any

  constructor(options?: any) {}

  abstract login(username: string, options: LoginOptions): Promise<LoginResult>
  abstract loginAndDecryptMemo(username: string, options: LoginOptions): Promise<LoginResult>
}
