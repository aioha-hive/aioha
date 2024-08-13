export interface RequestArguments {
  readonly method: string
  readonly params?: object
}

export class AiohaRpcError extends Error {
  code: number

  constructor(code: number, message: string) {
    super(message)
    this.code = code
    this.name = 'AiohaRpcError'
  }
}
