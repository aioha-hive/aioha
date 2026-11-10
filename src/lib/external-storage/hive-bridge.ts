import { GoogleDriveError, type GoogleTokenProvider } from './google-drive-storage.js'

/** Default Hive Bridge backend that brokers the Google OAuth flow. */
export const DEFAULT_HIVE_BRIDGE_URL = 'https://auth.openhive.network'

/** Hive Bridge endpoint returning the current Google access token. */
export const HIVE_BRIDGE_TOKEN_PATH = '/api/google-drive/token'

/** Hive Bridge endpoint that starts the Google OAuth flow. */
export const HIVE_BRIDGE_LOGIN_PATH = '/api/auth/google/login'

export interface GoogleDriveBridgeTokenProviderOptions {
  /** Hive Bridge backend URL. Defaults to {@link DEFAULT_HIVE_BRIDGE_URL}. */
  bridgeUrl?: string
  /**
   * Request credentials mode used when calling the bridge.
   * The bridge keeps the Google session in cookies, so this defaults to `'include'`.
   */
  credentials?: RequestCredentials
  /** Overrides `globalThis.fetch`, primarily useful for testing. */
  fetch?: typeof fetch
}

export type GoogleDriveBridgeTokenProvider = GoogleTokenProvider & {
  /** Hive Bridge backend URL in use. */
  readonly bridgeUrl: string
  /** URL that starts the Hive Bridge Google OAuth flow. */
  readonly loginUrl: string
}

/** Thrown when the Hive Bridge has no valid Google session. */
export class GoogleDriveBridgeAuthError extends GoogleDriveError {
  constructor(
    message: string,
    public readonly loginUrl: string,
    response?: unknown
  ) {
    super(message, 401, response)
    this.name = 'GoogleDriveBridgeAuthError'
  }
}

const parseBody = async (response: Response): Promise<unknown> => {
  const text = await response.text()
  if (!text) return undefined
  try {
    return JSON.parse(text)
  } catch {
    return text
  }
}

const getErrorMessage = (body: unknown, fallback: string): string => {
  if (typeof body === 'object' && body !== null && 'message' in body && typeof body.message === 'string')
    return body.message
  if (typeof body === 'string' && body) return body
  return fallback
}

const getToken = (body: unknown): string => {
  if (typeof body === 'object' && body !== null && 'token' in body && typeof body.token === 'string') return body.token
  return ''
}

/**
 * Creates a token provider backed by the Hive Bridge backend
 * (`/api/google-drive/token`). The bridge performs the Google OAuth flow and
 * keeps the refresh token server-side, so the browser only receives a short-lived
 * access token for the `drive.appdata` scope.
 *
 * The user must first sign in to Google through the bridge. When the bridge has
 * no session, the returned provider throws {@link GoogleDriveBridgeAuthError}
 * whose `loginUrl` points to the bridge's OAuth start endpoint.
 *
 * ```ts
 * const tokenProvider = createGoogleDriveBridgeTokenProvider()
 * // Defaults to https://auth.openhive.network
 * // const tokenProvider = createGoogleDriveBridgeTokenProvider({ bridgeUrl: 'https://auth.example.com' })
 *
 * const provider = new GoogleDriveProvider({ tokenProvider, passwordProvider, signer })
 * ```
 */
export const createGoogleDriveBridgeTokenProvider = (
  options: GoogleDriveBridgeTokenProviderOptions = {}
): GoogleDriveBridgeTokenProvider => {
  const bridgeUrl = (options.bridgeUrl ?? DEFAULT_HIVE_BRIDGE_URL).replace(/\/+$/, '')
  const loginUrl = `${bridgeUrl}${HIVE_BRIDGE_LOGIN_PATH}`
  const credentials = options.credentials ?? 'include'

  const tokenProvider = async (): Promise<string> => {
    const fetchImpl = options.fetch ?? globalThis.fetch
    if (typeof fetchImpl !== 'function')
      throw new Error('fetch is not available. Provide it through the fetch option or use a fetch-capable environment.')

    const response = await fetchImpl(`${bridgeUrl}${HIVE_BRIDGE_TOKEN_PATH}`, {
      method: 'GET',
      credentials,
      headers: { Accept: 'application/json' }
    })
    const body = await parseBody(response)

    if (!response.ok) {
      const message = getErrorMessage(body, response.statusText || 'request failed')
      if (response.status === 401)
        throw new GoogleDriveBridgeAuthError(
          `Hive Bridge is not authenticated with Google. Sign in at ${loginUrl}`,
          loginUrl,
          body
        )
      throw new GoogleDriveError(`Hive Bridge token request failed: ${message}`, response.status, body)
    }

    const token = getToken(body)
    if (!token) throw new GoogleDriveError('Hive Bridge returned an empty Google access token', response.status, body)
    return token
  }

  return Object.assign(tokenProvider, { bridgeUrl, loginUrl }) as GoogleDriveBridgeTokenProvider
}
