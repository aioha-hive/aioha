import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { HiveSigner } from '../src/providers/hivesigner.js'
import { AiohaClient } from '../src/rpc.js'
import { SimpleEventEmitter } from '../src/lib/event-emitter.js'

const ORIGIN = 'https://app.test'
let store: Record<string, string>
// What the callback page writes while the HiveSigner window is open (null: nothing).
let callback: { token: string; user: string } | null

const setLogin = (token: string, user: string) => {
  store.hivesignerToken = token
  store.hivesignerExpiry = String(Math.floor(Date.now() / 1000) + 3600)
  store.hivesignerUsername = user
}

const createProvider = () =>
  new HiveSigner(new AiohaClient('https://api.test'), new SimpleEventEmitter(), {
    app: 'test.app',
    callbackURL: ORIGIN + '/hivesigner.html'
  })

// login() polls every second until the HiveSigner window is closed.
const loginWith = async (hs: HiveSigner) => {
  const pending = hs.login('alice', {} as any)
  await vi.advanceTimersByTimeAsync(1000)
  return pending
}

beforeEach(() => {
  vi.useFakeTimers()
  store = {}
  callback = null
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => (k in store ? store[k] : null),
    setItem: (k: string, v: string) => {
      store[k] = String(v)
    },
    removeItem: (k: string) => {
      delete store[k]
    }
  })
  vi.stubGlobal('window', {
    location: { origin: ORIGIN },
    open: () => {
      if (callback) setLogin(callback.token, callback.user)
      return { closed: true }
    }
  })
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('HiveSigner logout', () => {
  it('clears the stored login even when revoking the token fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ error: 'invalid_grant' }), { status: 401 }))
    )
    callback = { token: 'dead-token', user: 'alice' }
    const hs = createProvider()
    expect((await loginWith(hs)).success).toBe(true)

    await hs.logout()

    expect(store).toEqual({})
    expect(hs.getUser()).toBeUndefined()
  })
})

describe('HiveSigner login', () => {
  it('does not accept a token left in storage from an earlier session', async () => {
    setLogin('old-token', 'alice')
    const hs = createProvider()
    const result = await loginWith(hs)
    expect(result.success).toBe(false)
    expect(hs.getUser()).toBeUndefined()
  })

  it('accepts the token the callback page wrote during this login', async () => {
    setLogin('old-token', 'alice')
    callback = { token: 'fresh-token', user: 'alice' }
    const result = await loginWith(createProvider())
    expect(result).toMatchObject({ success: true, result: 'fresh-token', username: 'alice' })
  })
})
