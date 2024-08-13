// HiveAuth wrapper with types
// https://github.com/hiveauth/hive-auth-wrapper/blob/master/has-wrapper.js
import type CryptoJSType from 'crypto-js'

let CryptoJS: typeof CryptoJSType

enum CMD {
  CONNECTED = 'connected',
  AUTH_REQ = 'auth_req',
  AUTH_WAIT = 'auth_wait',
  AUTH_ACK = 'auth_ack',
  AUTH_NACK = 'auth_nack',
  AUTH_ERR = 'auth_err',
  SIGN_REQ = 'sign_req',
  SIGN_WAIT = 'sign_wait',
  SIGN_ACK = 'sign_ack',
  SIGN_NACK = 'sign_nack',
  SIGN_ERR = 'sign_err',
  CHALLENGE_REQ = 'challenge_req',
  CHALLENGE_WAIT = 'challenge_wait',
  CHALLENGE_ACK = 'challenge_ack',
  CHALLENGE_NACK = 'challenge_nack',
  CHALLENGE_ERR = 'challenge_err',
  ATTACH_REQ = 'attach_req',
  ATTACH_ACK = 'attach_ack',
  ATTACH_NACK = 'attach_nack',
  ERROR = 'error'
}

const DELAY_CHECK_WEBSOCKET = 250 // Delay between checking WebSocket connection (in milliseconds)
const DELAY_CHECK_REQUESTS = 250 // Delay between checking HAS events (in milliseconds)
const HAS_SERVER = 'wss://hive-auth.arcange.eu/' // Default HAS infrastructure host

const HAS_PROTOCOLS = [0.8, 1] // Supported protocols
type HAS_options_type = {
  host: string
  auth_key_secret?: string
}
const HAS_options: HAS_options_type = {
  host: HAS_SERVER
}

export type AppMetaType = {
  name: string
  description?: string
  icon?: string
}

export enum KeyType {
  Posting = 'posting',
  Active = 'active',
  Memo = 'memo'
}
type ChallengeDataType = {
  key_type: KeyType
  challenge: string
}

let HAS_connected = false
let HAS_timeout = 60 * 1000 // default request expiration timeout (60 seconds)

export type MessageType = {
  cmd: CMD
  uuid: string
  data: string
  expire: number
  key: string
  error?: string
}
let messages: MessageType[] = []
let wsHAS: WebSocket | null
let trace = false

type ChallengeResult = {
  challenge: string
  pubkey: string
}
type AuthAckDataType = {
  challenge: ChallengeResult
  expire: number
  token: string
}
function getMessage(type: CMD, uuid?: string) {
  // Clean expired requests
  messages = messages.filter((o) => !o.expire || o.expire >= Date.now())
  // Search for first matching request
  const req = messages.find((o) => o.cmd == type && (uuid ? o.uuid == uuid : true))
  // If any found, remove it from the array
  if (req) {
    messages = messages.filter((o) => !(o.cmd == type && (uuid ? o.uuid == req.uuid : true)))
  }
  return req
}

// HAS client
function startWebsocket() {
  wsHAS = new WebSocket(HAS_options.host)
  wsHAS.onopen = function () {
    // Web Socket is connected
    HAS_connected = true
    if (trace) console.log('WebSocket connected')
  }
  wsHAS.onmessage = function (event) {
    if (trace) console.log(`[RECV] ${event.data}`)
    const message = typeof event.data == 'string' ? JSON.parse(event.data) : event.data
    // Process HAS <-> App messages
    if (message.cmd) {
      switch (message.cmd) {
        case CMD.CONNECTED:
          HAS_timeout = message.timeout * 1000
          if (!HAS_PROTOCOLS.includes(message.protocol)) {
            console.error('unsupported HAS protocol')
          }
          break
        case CMD.AUTH_WAIT:
        case CMD.AUTH_ACK:
        case CMD.AUTH_NACK:
        case CMD.AUTH_ERR:
        case CMD.SIGN_WAIT:
        case CMD.SIGN_ACK:
        case CMD.SIGN_NACK:
        case CMD.SIGN_ERR:
        case CMD.CHALLENGE_WAIT:
        case CMD.CHALLENGE_ACK:
        case CMD.CHALLENGE_NACK:
        case CMD.CHALLENGE_ERR:
        case CMD.ATTACH_ACK:
        case CMD.ATTACH_NACK:
        case CMD.ERROR:
          messages.push(message)
          break
      }
    }
  }
  wsHAS.onclose = function (event) {
    // connection closed, discard old websocket
    wsHAS = null
    HAS_connected = false
    if (trace) console.log('WebSocket disconnected', event)
  }
}

function send(message: string) {
  if (!wsHAS) return
  if (trace) console.log(`[SEND] ${message}`)
  wsHAS.send(message)
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

class HiveAuthInternalError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'HiveAuthInternalError'
  }
}

async function attach(uuid: string) {
  return new Promise(async (resolve, reject) => {
    if (typeof uuid !== 'string') return reject(new HiveAuthInternalError('invalid uuid'))
    // Send the attach request to the HAS
    const payload = { cmd: CMD.ATTACH_REQ, uuid }
    send(JSON.stringify(payload))
    let expire = Date.now() + HAS_timeout
    // Wait for the reply from the HAS
    const wait = setInterval(() => {
      // Confirmation received, check if we got a request result
      const req_ack = getMessage(CMD.ATTACH_ACK, uuid)
      const req_nack = getMessage(CMD.ATTACH_NACK, uuid)
      if (req_ack) {
        // attach success
        clearInterval(wait)
        if (trace) console.log(`attach_ack found: ${JSON.stringify(req_ack)}`)
        resolve(req_ack)
      } else if (req_nack) {
        // attach failed
        clearInterval(wait)
        reject(req_nack)
      }
      // check if request expired
      if (expire <= Date.now()) {
        clearInterval(wait)
        reject(new Error('expired'))
      }
    }, DELAY_CHECK_REQUESTS)
  })
}

async function checkConnection(uuid?: string) {
  if ('WebSocket' in window) {
    // The browser support Websocket
    if (HAS_connected) {
      return true
    }
    if (!wsHAS) {
      startWebsocket()
    }
    if (!HAS_connected) {
      // connection not completed yet, wait till ready
      do {
        await sleep(DELAY_CHECK_WEBSOCKET)
      } while (wsHAS && wsHAS.readyState == 0) // 0 = Connecting
    }
    if (HAS_connected && uuid) {
      // WebSocket reconnected, try to attach pending request if any
      try {
        await attach(uuid)
        if (trace) console.log(`Request attached ${uuid}`)
      } catch (e) {
        return false
      }
    }
    return HAS_connected
  } else {
    return false
  }
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

const check = async (auth?: Auth | null, challenge?: ChallengeDataType) => {
  if (!CryptoJS) return 'call initCrypto() first'
  if (auth) {
    if (!auth.username && typeof auth.username !== 'string') return 'invalid auth.username'
    else if (!auth.key || typeof auth.key !== 'string') return 'missing or invalid auth.key'
    else if (!auth.token || typeof auth.token !== 'string') return 'missing or invalid token'
  }
  if (challenge) {
    if (challenge.key_type && typeof challenge.key_type !== 'string') return 'missing or invalid challenge_data.key_type'
    if (challenge.challenge && typeof challenge.challenge == 'string') return 'missing or invalid challenge_data.challenge'
  }
  if (!(await checkConnection())) return 'failed to connect to HiveAuth server'
  return null
}

export default {
  setOptions: function (options: HAS_options_type) {
    if (options.host && !options.host.match('^((ws|wss)?://)')) throw new Error('invalid host URL')
    if (options.auth_key_secret && (typeof options.auth_key_secret !== 'string' || options.auth_key_secret === ''))
      throw new Error('invalid auth_key_secret')
    if (options.host) {
      HAS_options.host = options.host
    }
    if (options.auth_key_secret) {
      console.warn('Warning: do not enable SendAuthKey unless you run your own PKSA in service mode!')
      HAS_options.auth_key_secret = options.auth_key_secret
    }
  },

  traceOn: function () {
    trace = true
  },
  traceOff: function () {
    trace = false
  },

  status: function () {
    return { host: HAS_options.host, connected: HAS_connected, timeout: HAS_timeout }
  },

  connect: async function () {
    return await checkConnection()
  },

  initCrypto: async function () {
    CryptoJS = (await import(/* webpackChunkName: 'cryptojs' */ 'crypto-js')).default
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
  authenticate: function (
    auth: Auth,
    username: string,
    challenge_data: ChallengeDataType,
    cbWait?: (payload: string, evt: MessageType, cancel: () => void) => any
  ) {
    return new Promise<AuthAckDataType>(async (resolve, reject) => {
      try {
        const initialChecks = await check(null, challenge_data)
        if (typeof initialChecks === 'string') return reject(new HiveAuthInternalError(initialChecks))
        if (typeof username !== 'string' || username.length < 3) return reject(new HiveAuthInternalError('invalid username'))

        // initialize key to encrypt communication with PKSA
        const auth_key = auth.key || window.crypto.randomUUID()
        const data = CryptoJS.AES.encrypt(
          JSON.stringify({ app: auth.getAppMetadata(), challenge: challenge_data, token: auth.token }),
          auth_key
        ).toString()
        const payload: {
          cmd: CMD
          account: string
          data: string
          auth_key?: string
          token?: string
        } = { cmd: CMD.AUTH_REQ, account: username, data: data, token: auth.token }
        // NOTE:    If the PKSA runs in "service" mode, we can pass the encryption key with the auth_req
        //          When the PKSA will process the "auth_req", it will bypass the offline reading of the encryption key
        if (HAS_options.auth_key_secret) {
          // Encrypt auth_key before sending it to the HAS
          payload.auth_key = CryptoJS.AES.encrypt(auth_key, HAS_options.auth_key_secret).toString()
        }

        send(JSON.stringify(payload))
        let expire = Date.now() + HAS_timeout
        let uuid: string
        let busy = false
        const wait = setInterval(async () => {
          if (!busy) {
            busy = true
            if (!uuid) {
              const req = getMessage(CMD.AUTH_WAIT)
              const err = getMessage(CMD.ERROR)
              if (req) {
                if (trace) console.log(`auth_wait found: ${JSON.stringify(req)}`)
                uuid = req.uuid
                expire = req.expire
                // provide the PKSA encryption key to the App for it to build the auth_payload
                req.key = auth_key
                // call app back to notify about pending request and authentication payload
                if (cbWait) {
                  const payload = {
                    account: username,
                    uuid: uuid,
                    key: auth_key,
                    host: HAS_SERVER
                  }
                  cbWait('has://auth_req/' + window.btoa(JSON.stringify(payload)), req, () => {
                    clearInterval(wait)
                    reject(new Error('cancelled'))
                  })
                }
              } else if (err) {
                if (trace) console.log(`error found: ${JSON.stringify(err)}`)
                reject(err)
              }
            } else {
              // Check if WebSocket is still connected (and optionally attach pending request)
              await checkConnection(uuid)
              const req_ack = getMessage(CMD.AUTH_ACK, uuid)
              const req_nack = getMessage(CMD.AUTH_NACK, uuid)
              const req_err = getMessage(CMD.AUTH_ERR, uuid)
              if (req_ack) {
                try {
                  // Try to decrypt and parse payload data
                  const ack_data: AuthAckDataType = JSON.parse(
                    CryptoJS.AES.decrypt(req_ack.data, auth_key).toString(CryptoJS.enc.Utf8)
                  )
                  // authentication approved
                  clearInterval(wait)
                  if (trace) console.log(`auth_ack found: ${JSON.stringify(req_ack)}`)
                  // update credentials with the PKSA expiration and encryption key
                  auth.setUsername(username)
                  auth.token = ack_data.token
                  auth.expire = ack_data.expire
                  auth.key = auth_key
                  resolve(ack_data)
                } catch (e) {
                  // Decryption failed - ignore message
                  reject(e)
                }
              } else if (req_nack) {
                // validate uuid
                if (uuid == CryptoJS.AES.decrypt(req_nack.data, auth_key).toString(CryptoJS.enc.Utf8)) {
                  // authentication rejected
                  clearInterval(wait)
                  reject(req_nack)
                }
              } else if (req_err) {
                // authentication error
                clearInterval(wait)
                reject(req_err)
              }
            }
          }
          busy = false
          // Check if authentication request has expired
          if (expire <= Date.now()) {
            clearInterval(wait)
            reject(new Error('expired'))
          }
        }, DELAY_CHECK_REQUESTS)
      } catch (e) {
        reject(e)
      }
    })
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
  signTx: function (
    auth: Auth,
    key_type: KeyType,
    ops: any,
    broadcast: boolean,
    cbWait?: (evt: MessageType, cancel: () => void) => any
  ) {
    return new Promise<MessageType>(async (resolve, reject) => {
      const initialChecks = await check(auth)
      if (typeof initialChecks === 'string') return reject(new HiveAuthInternalError(initialChecks))
      if (!ops || !Array.isArray(ops) || ops.length === 0) return reject(new HiveAuthInternalError('missing or invalid ops'))

      // Encrypt the ops with the key we provided to the PKSA
      const data = CryptoJS.AES.encrypt(
        JSON.stringify({ key_type: key_type, ops: ops, broadcast, nonce: Date.now() }),
        auth.key!
      ).toString()
      // Send the sign request to the HAS
      const payload = { cmd: CMD.SIGN_REQ, account: auth.username, data: data, token: auth.token }
      send(JSON.stringify(payload))
      let expire = Date.now() + HAS_timeout
      let uuid: string
      let busy = false
      // Wait for the confirmation by the HAS
      const wait = setInterval(async () => {
        if (!busy) {
          busy = true
          if (!uuid) {
            // We did not received the sign_wait confirmation yet from the HAS
            // check if we got one
            const req = getMessage(CMD.SIGN_WAIT)
            const err = getMessage(CMD.ERROR)
            if (req) {
              // confirmation received
              if (trace) console.log(`sign_wait found: ${JSON.stringify(req)}`)
              uuid = req.uuid
              expire = req.expire
              // call back app to notify about pending request
              if (cbWait)
                cbWait(req, () => {
                  clearInterval(wait)
                  reject(new Error('cancelled'))
                })
            } else if (err) {
              if (trace) console.log(`error found: ${JSON.stringify(err)}`)
              reject(err)
            }
          } else {
            // Check if WebSocket is still connected (and optionally attach pending request)
            await checkConnection(uuid)
            // Confirmation received, check if we got a request result
            const req_ack = getMessage(CMD.SIGN_ACK, uuid)
            const req_nack = getMessage(CMD.SIGN_NACK, uuid)
            const req_err = getMessage(CMD.SIGN_ERR, uuid)
            if (req_ack) {
              // request approved
              if (trace) console.log(`sign_ack found: ${JSON.stringify(req_ack)}`)
              clearInterval(wait)
              resolve(req_ack)
            } else if (req_nack) {
              // request rejected
              clearInterval(wait)
              reject(req_nack)
            } else if (req_err) {
              // request error
              clearInterval(wait)
              // Decrypt received error message
              const error = CryptoJS.AES.decrypt(req_err.error!, auth.key!).toString(CryptoJS.enc.Utf8)
              reject(new Error(error))
            }
          }
        }
        busy = false
        // check if request expired
        if (expire <= Date.now()) {
          clearInterval(wait)
          reject(new Error('expired'))
        }
      }, DELAY_CHECK_REQUESTS)
    })
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
  challenge: function (auth: Auth, challenge_data: ChallengeDataType, cbWait?: (evt: MessageType, cancel: () => void) => any) {
    return new Promise<ChallengeResult>(async (resolve, reject) => {
      const initialChecks = await check(auth, challenge_data)
      if (typeof initialChecks === 'string') return reject(new HiveAuthInternalError(initialChecks))

      // Encrypt the challenge data with the key we provided to the PKSA
      const data = CryptoJS.AES.encrypt(JSON.stringify(challenge_data), auth.key!).toString()
      // Send the challenge request to the HAS
      const payload = { cmd: CMD.CHALLENGE_REQ, account: auth.username, data: data, token: auth.token }
      send(JSON.stringify(payload))
      let expire = Date.now() + HAS_timeout
      let uuid: string
      let busy = false
      // Wait for the confirmation by the HAS
      const wait = setInterval(async () => {
        if (!busy) {
          busy = true
          if (!uuid) {
            // We did not received the challenge_wait confirmation yet from the HAS
            // check if we got one
            const req = getMessage(CMD.CHALLENGE_WAIT)
            const err = getMessage(CMD.ERROR)
            if (req) {
              // confirmation received
              if (trace) console.log(`challenge_wait found: ${JSON.stringify(req)}`)
              uuid = req.uuid
              expire = req.expire
              // call back app to notify about pending request
              if (cbWait)
                cbWait(req, () => {
                  clearInterval(wait)
                  reject(new Error('cancelled'))
                })
            } else if (err) {
              if (trace) console.log(`error found: ${JSON.stringify(err)}`)
              reject(err)
            }
          } else {
            // Check if WebSocket is still connected (and optionally attach pending request)
            await checkConnection(uuid)
            // Confirmation received, check if we got a request result
            const req_ack = getMessage(CMD.CHALLENGE_ACK, uuid)
            const req_nack = getMessage(CMD.CHALLENGE_NACK, uuid)
            const req_err = getMessage(CMD.CHALLENGE_ERR, uuid)
            if (req_ack) {
              // request approved
              try {
                // Try to decrypt and parse payload data
                const result: ChallengeResult = JSON.parse(
                  CryptoJS.AES.decrypt(req_ack.data, auth.key!).toString(CryptoJS.enc.Utf8)
                )
                // challenge approved
                clearInterval(wait)
                if (trace) console.log(`challenge_ack found: ${JSON.stringify(req_ack)}`)
                resolve(result)
              } catch (e) {
                // Decryption failed - ignore message
              }
            } else if (req_nack) {
              // request rejected
              clearInterval(wait)
              reject(req_nack)
            } else if (req_err) {
              // request error
              clearInterval(wait)
              // Decrypt received error message
              const error = CryptoJS.AES.decrypt(req_err.error!, auth.key!).toString(CryptoJS.enc.Utf8)
              reject(new Error(error))
            }
          }
        }
        busy = false
        // check if request expired
        if (expire <= Date.now()) {
          clearInterval(wait)
          reject(new Error('expired'))
        }
      }, DELAY_CHECK_REQUESTS)
    })
  }
}
