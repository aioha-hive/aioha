import { StorageFileNotFoundError, type WalletStorage } from './storage.js'

/** Returns a valid Google OAuth2 access token, invoked before each Google Drive API call. */
export type GoogleTokenProvider = () => Promise<string> | string

/** Error thrown when a Google Drive API operation fails. */
export class GoogleDriveError extends Error {
  constructor(
    message: string,
    public readonly statusCode?: number,
    public readonly response?: unknown
  ) {
    super(message)
    this.name = 'GoogleDriveError'
  }
}

/**
 * Google Drive storage backed by the Drive REST API.
 *
 * Wallet files are stored in the hidden `appDataFolder`, so only this application
 * can see them. No googleapis dependency is required: the application supplies an
 * access token for the `drive.appdata` scope through {@link GoogleTokenProvider}.
 */
export class GoogleDriveStorage implements WalletStorage {
  private readonly baseUrl = 'https://www.googleapis.com/drive/v3'
  private readonly uploadUrl = 'https://www.googleapis.com/upload/drive/v3'

  constructor(private readonly tokenProvider: GoogleTokenProvider) {}

  private async request<T = unknown>(url: string, init: RequestInit = {}): Promise<T> {
    const token = await this.tokenProvider()
    if (!token) throw new GoogleDriveError('token provider returned an empty token')
    const headers = new Headers(init.headers)
    headers.set('Authorization', `Bearer ${token}`)
    const response = await fetch(url, { ...init, headers })
    if (!response.ok) {
      let details: unknown
      const contentType = response.headers.get('content-type')
      try {
        details = contentType?.includes('application/json') ? await response.json() : await response.text()
      } catch {
        details = 'unable to parse error response'
      }
      throw new GoogleDriveError(`Google Drive API error: ${response.statusText}`, response.status, details)
    }
    const contentType = response.headers.get('content-type')
    if (contentType?.includes('application/json')) return response.json() as Promise<T>
    return response.text() as Promise<T>
  }

  private async findFileId(name: string): Promise<string | null> {
    const escaped = name.replace(/\\/g, '\\\\').replace(/'/g, "\\'")
    const query = `name='${escaped}' and trashed=false`
    const url = `${this.baseUrl}/files?q=${encodeURIComponent(query)}&spaces=appDataFolder&fields=files(id,name)`
    const data = await this.request<{ files?: Array<{ id?: string; name?: string }> }>(url)
    return data.files?.[0]?.id ?? null
  }

  async get(name: string): Promise<string> {
    const fileId = await this.findFileId(name)
    if (!fileId) throw new StorageFileNotFoundError(`file '${name}' not found in Google Drive`)
    try {
      return await this.request<string>(`${this.baseUrl}/files/${fileId}?alt=media`)
    } catch (e) {
      if (e instanceof GoogleDriveError && e.statusCode === 404)
        throw new StorageFileNotFoundError(`file '${name}' not found in Google Drive`)
      throw e
    }
  }

  async save(name: string, data: string): Promise<void> {
    const fileId = await this.findFileId(name)
    if (fileId) {
      await this.request(`${this.uploadUrl}/files/${fileId}?uploadType=media`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'text/plain' },
        body: data
      })
      return
    }
    const boundary = '-------aioha-google-drive-boundary'
    const body = [
      `--${boundary}`,
      'Content-Type: application/json; charset=UTF-8',
      '',
      JSON.stringify({ name, parents: ['appDataFolder'], mimeType: 'text/plain' }),
      `--${boundary}`,
      'Content-Type: text/plain',
      '',
      data,
      `--${boundary}--`
    ].join('\r\n')
    await this.request(`${this.uploadUrl}/files?uploadType=multipart`, {
      method: 'POST',
      headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
      body
    })
  }

  async delete(name: string): Promise<void> {
    const fileId = await this.findFileId(name)
    if (!fileId) throw new StorageFileNotFoundError(`file '${name}' not found in Google Drive`)
    try {
      await this.request(`${this.baseUrl}/files/${fileId}`, { method: 'DELETE' })
    } catch (e) {
      if (e instanceof GoogleDriveError && e.statusCode === 404)
        throw new StorageFileNotFoundError(`file '${name}' not found in Google Drive`)
      throw e
    }
  }

  async exists(name: string): Promise<boolean> {
    try {
      return (await this.findFileId(name)) !== null
    } catch (e) {
      if (e instanceof GoogleDriveError && e.statusCode === 404) return false
      throw e
    }
  }
}
