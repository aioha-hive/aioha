// HiveAuth wrapper with types
// https://github.com/hiveauth/hive-auth-wrapper/blob/master/has-wrapper.js
import type { CMD } from './hiveauth-has.js'
import type { KeyTypes } from '../types.js'

const HAS_SERVER = 'wss://hive-auth.arcange.eu/' // Default HAS infrastructure host

export type AppMetaType = {
  name: string
  description?: string
  icon?: string
}

export type MessageType = {
  cmd: CMD
  uuid: string
  data: string
  expire: number
  key: string
  error?: string
}

export type ChallengeDataType = {
  key_type: KeyTypes
  challenge: string
  decrypt?: boolean
  nonce: number
}

export type ChallengeResult = {
  challenge: string
  pubkey: string
}

export type AuthAckDataType = {
  challenge: ChallengeResult
  expire: number
  token: string
}

export type CBWait = (payload: string, evt: MessageType, cancel: () => void) => any

/**
 * Mutable HiveAuth state shared between this always-loaded API and the lazily
 * loaded HAS client, keeping `status()`, `setOptions()` and `traceOn/Off()` synchronous.
 */
export type HASState = {
  host: string
  server: string
  authKeySecret?: string
  connected: boolean
  timeout: number
  trace: boolean
}

const state: HASState = {
  host: HAS_SERVER,
  // host passed to the app in cbWait payloads (always the default HAS, as before)
  server: HAS_SERVER,
  connected: false,
  timeout: 60 * 1000, // default request expiration timeout (60 seconds)
  trace: false
}

export type HASClient = {
  connect: () => Promise<boolean>
  authenticate: (auth: Auth, username: string, challenge_data: ChallengeDataType, cbWait?: CBWait) => Promise<AuthAckDataType>
  signTx: (auth: Auth, key_type: KeyTypes, ops: any, broadcast: boolean, cbWait?: CBWait) => Promise<MessageType>
  challenge: (auth: Auth, challenge_data: ChallengeDataType, cbWait?: CBWait) => Promise<ChallengeResult>
}

type HASOptions = {
  host: string
  auth_key_secret?: string
}

export class Auth {
  username?: string
  appMeta: AppMetaType
  expire?: number
  key?: string
  token?: string

  constructor(appMetadata: AppMetaType) {
    if (!appMetadata || typeof appMetadata.name !== 'string') throw new Error('missing or invalid app metadata name')
    this.appMeta = appMetadata
  }

  getAppMetadata() {
    return this.appMeta
  }

  setUsername(username: string) {
    this.username = username
  }

  logout() {
    delete this.username
    delete this.expire
    delete this.key
  }
}

let hasClient: Promise<HASClient> | undefined

// Load the HAS client (and the AES helpers it uses) on first HiveAuth request
function loadHAS() {
  if (!hasClient) {
    hasClient = import(/* webpackChunkName: 'hiveauth' */ './hiveauth-has.js')
      .then((mod) => mod.createHASClient(state))
      .catch((e) => {
        // chunk failed to load, allow a later call to retry
        hasClient = undefined
        throw e
      })
  }
  return hasClient
}

export default {
  setOptions: function (options: HASOptions) {
    if (options.host && !options.host.match('^((ws|wss)?://)')) throw new Error('invalid host URL')
    if (options.auth_key_secret && (typeof options.auth_key_secret !== 'string' || options.auth_key_secret === ''))
      throw new Error('invalid auth_key_secret')
    if (options.host) {
      state.host = options.host
    }
    if (options.auth_key_secret) {
      console.warn('Warning: do not enable SendAuthKey unless you run your own PKSA in service mode!')
      state.authKeySecret = options.auth_key_secret
    }
  },

  traceOn: function () {
    state.trace = true
  },
  traceOff: function () {
    state.trace = false
  },

  status: function () {
    return { host: state.host, connected: state.connected, timeout: state.timeout }
  },

  connect: async function () {
    return (await loadHAS()).connect()
  },

  /**
   * Sends an authentication request to the server
   * @param {Object} auth
   * @param {string} auth.username
   * @param {number=} auth.expire
   * @param {string=} auth.key
   * @param {Object} challenge_data - (optional)
   * @param {string} challenge_data.key_type - key type required to sign the challenge (posting, acive, memo)
   * @param {string} challenge_data.challenge - a string to be signed
   * @param {Object} cbWait - (optional) callback method to notify the app about pending request
   */
  authenticate: async function (auth: Auth, username: string, challenge_data: ChallengeDataType, cbWait?: CBWait) {
    return (await loadHAS()).authenticate(auth, username, challenge_data, cbWait)
  },

  /**
   * Sends a broadcast request to the server
   * @param {Object} auth
   * @param {string} auth.username
   * @param {string} auth.token
   * @param {number=} auth.expire
   * @param {string=} auth.key
   * @param {string} key_type
   * @param {Array} ops
   * @param {Object} cbWait - (optional) callback method to notify the app about pending request
   */
  signTx: async function (auth: Auth, key_type: KeyTypes, ops: any, broadcast: boolean, cbWait?: CBWait) {
    return (await loadHAS()).signTx(auth, key_type, ops, broadcast, cbWait)
  },
  /**
   * Sends a challenge request to the server
   * @param {Object} auth
   * @param {string} auth.username
   * @param {string} auth.token
   * @param {number=} auth.expire
   * @param {string=} auth.key
   * @param {Object} challenge_data
   * @param {string} challenge_data.key_type - key type required to sign the challenge (posting, acive, memo)
   * @param {string} challenge_data.challenge - a string to be signed
   * @param {Object} cbWait - (optional) callback method to notify the app about pending request
   */
  challenge: async function (auth: Auth, challenge_data: ChallengeDataType, cbWait?: CBWait) {
    return (await loadHAS()).challenge(auth, challenge_data, cbWait)
  }
}
