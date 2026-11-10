import type { GoogleTokenProvider } from './google-drive-storage.js'

/** OAuth scope granting access to the hidden Google Drive app data folder. */
export const GOOGLE_DRIVE_APPDATA_SCOPE = 'https://www.googleapis.com/auth/drive.appdata'

interface GoogleTokenResponse {
  access_token?: string
  expires_in?: number | string
  error?: string
  error_description?: string
}

interface GoogleTokenClient {
  requestAccessToken(): void
}

interface GoogleOAuth2 {
  initTokenClient(config: {
    client_id: string
    scope: string
    prompt?: string
    callback: (response: GoogleTokenResponse) => void
  }): GoogleTokenClient
}

/** Minimal shape of the Google Identity Services global. */
export interface GoogleIdentityServices {
  accounts?: {
    oauth2?: GoogleOAuth2
  }
}

export interface GoogleDriveTokenProviderOptions {
  /** Google OAuth2 client ID (the client secret must stay on your server). */
  clientId: string
  /** OAuth scope. Defaults to {@link GOOGLE_DRIVE_APPDATA_SCOPE}. */
  scope?: string
  /** Google consent prompt parameter. Defaults to `''` (only show when required). */
  prompt?: string
  /** Overrides `globalThis.google`, primarily useful for testing. */
  google?: GoogleIdentityServices
}

export type GoogleDriveTokenProvider = GoogleTokenProvider & {
  /** Clears the cached access token. */
  clearToken(): void
}

/**
 * Creates a token provider backed by Google Identity Services
 * (`google.accounts.oauth2`). Load the GIS script before calling the provider:
 *
 * ```html
 * <script src="https://accounts.google.com/gsi/client" async defer></script>
 * ```
 *
 * The provider caches access tokens until shortly before they expire and asks
 * Google for a new one when needed.
 */
export const createGoogleDriveTokenProvider = (
  options: GoogleDriveTokenProviderOptions
): GoogleDriveTokenProvider => {
  const scope = options.scope ?? GOOGLE_DRIVE_APPDATA_SCOPE
  let accessToken: string | undefined
  let expiresAt = 0
  let pending: Promise<string> | undefined
  let tokenClient: GoogleTokenClient | undefined
  let callback: ((response: GoogleTokenResponse) => void) | undefined

  const getGoogle = (): GoogleIdentityServices => {
    const google = options.google ?? (globalThis as { google?: GoogleIdentityServices }).google
    if (!google?.accounts?.oauth2)
      throw new Error(
        'Google Identity Services is not loaded. Load https://accounts.google.com/gsi/client or provide a tokenProvider.'
      )
    return google
  }

  const requestToken = (): Promise<string> =>
    new Promise<string>((resolve, reject) => {
      callback = (response) => {
        if (response.error || !response.access_token) {
          reject(new Error(response.error_description ?? response.error ?? 'Google authorization failed'))
          return
        }
        accessToken = response.access_token
        const expiresIn = typeof response.expires_in === 'string' ? parseInt(response.expires_in, 10) : response.expires_in
        expiresAt = Date.now() + (Number.isFinite(expiresIn) ? expiresIn! : 3600) * 1000
        resolve(accessToken)
      }
      if (!tokenClient)
        tokenClient = getGoogle().accounts!.oauth2!.initTokenClient({
          client_id: options.clientId,
          scope,
          prompt: options.prompt ?? '',
          callback: (response) => callback?.(response)
        })
      tokenClient.requestAccessToken()
    })

  const getToken = async (): Promise<string> => {
    if (accessToken && expiresAt - 60_000 > Date.now()) return accessToken
    if (pending) return pending
    pending = requestToken().finally(() => {
      pending = undefined
    })
    return pending
  }

  const provider = getToken as GoogleDriveTokenProvider
  provider.clearToken = () => {
    accessToken = undefined
    expiresAt = 0
    tokenClient = undefined
    callback = undefined
  }
  return provider
}
