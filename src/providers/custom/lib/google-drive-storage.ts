/*
 * Google Drive storage provider for the Aioha external wallet provider.
 * Vendored from @hiveio/wax-signers-external (https://gitlab.syncad.com/hive/wax),
 * Copyright (c) 2024 Hive community, licensed under the MIT License.
 * https://github.com/aioha-hive/aioha
 */

import { AStorageProviderBase, StorageFileNotFoundError } from './storage-provider.js'

/**
 * Error thrown when Google Drive API operations fail.
 */
export class GoogleDriveError extends Error {
  public readonly cause?: Error
  public constructor(
    message: string,
    cause?: Error,
    public readonly statusCode?: number,
    public readonly response?: any
  ) {
    super(message)
    this.name = 'GoogleDriveError'
    this.cause = cause
  }
}

/**
 * Token provider callback function type.
 * This function should return a valid Google OAuth2 access token.
 * The callback will be invoked before each API call to ensure fresh tokens.
 */
export type TokenProvider = () => Promise<string> | string

/**
 * Google Drive storage provider that uses a callback to fetch tokens and REST API.
 *
 * This provider stores encrypted wallet data as files in Google Drive's appDataFolder
 * using the REST API directly (no googleapis dependency). It accepts a token provider
 * callback function, allowing the application to manage token refresh logic externally.
 *
 * This works in both Node.js and browser environments, making it ideal for:
 * - Browser applications where tokens are managed server-side
 * - Universal/isomorphic applications
 * - Any environment with fetch support
 */
export class GoogleStorageProvider extends AStorageProviderBase {
  private readonly tokenProvider: TokenProvider
  private readonly baseUrl = 'https://www.googleapis.com/drive/v3'
  private readonly uploadUrl = 'https://www.googleapis.com/upload/drive/v3'

  /**
   * Creates a new Google Drive storage provider with token callback.
   * @param tokenProvider - Function that returns a valid Google OAuth2 access token.
   * The token MUST have the 'https://www.googleapis.com/auth/drive.appdata' scope.
   */
  public constructor(tokenProvider: TokenProvider) {
    super()
    this.tokenProvider = tokenProvider
  }

  /**
   * Get fresh token from provider.
   */
  private async getToken(): Promise<string> {
    const token = await this.tokenProvider()
    if (!token) throw new GoogleDriveError('Token provider returned empty token')
    return token
  }

  /**
   * Make authenticated request to Google Drive API.
   */
  private async request<T = any>(url: string, options: RequestInit = {}): Promise<T> {
    const token = await this.getToken()
    const response = await fetch(url, {
      ...options,
      headers: {
        Authorization: `Bearer ${token}`,
        ...options.headers
      }
    })
    if (!response.ok) {
      let errorDetails: any
      const contentType = response.headers.get('content-type')
      try {
        if (contentType?.includes('application/json')) errorDetails = await response.json()
        else errorDetails = await response.text()
      } catch {
        errorDetails = 'Unable to parse error response'
      }
      throw new GoogleDriveError(`Google Drive API error: ${response.statusText}`, undefined, response.status, errorDetails)
    }
    const contentType = response.headers.get('content-type')
    // For text/plain responses, always use text()
    if (contentType?.includes('text/plain')) return response.text() as T
    // For JSON responses, parse as JSON
    if (contentType?.includes('application/json')) return response.json()
    // Default to text for unknown content types
    return response.text() as T
  }

  /**
   * Searches for a file by name in the appDataFolder.
   */
  private async findFileId(name: string): Promise<string | null> {
    try {
      const query = `name='${name}' and trashed=false`
      const url = `${this.baseUrl}/files?q=${encodeURIComponent(query)}&spaces=appDataFolder&fields=files(id,name)`
      const data = await this.request<{ files?: Array<{ id?: string; name?: string }> }>(url)
      if (!data.files || data.files.length === 0) return null
      return data.files[0].id ?? null
    } catch (error) {
      if (error instanceof GoogleDriveError) {
        console.error('Google Drive API Error:', {
          message: error.message,
          statusCode: error.statusCode,
          response: error.response
        })
      }
      throw new GoogleDriveError(
        `Failed to search for file: ${error instanceof Error ? error.message : error}`,
        error instanceof Error ? error : undefined
      )
    }
  }

  /**
   * Retrieves the content of a file from Google Drive's appDataFolder.
   * @param name - Name of the file to retrieve
   * @returns The file content as a string
   * @throws {GoogleDriveError} If the file doesn't exist or cannot be retrieved
   */
  public async get(name: string): Promise<string> {
    const fileId = await this.findFileId(name)
    if (!fileId) throw new StorageFileNotFoundError(`File '${name}' not found in Google Drive`)
    try {
      const url = `${this.baseUrl}/files/${fileId}?alt=media`
      return await this.request<string>(url)
    } catch (error) {
      throw new GoogleDriveError(`Failed to retrieve file '${name}': ${error instanceof Error ? error.message : error}`)
    }
  }

  /**
   * Saves data to a file in Google Drive's appDataFolder.
   * If the file exists, it will be updated. Otherwise, a new file will be created.
   * @param name - Name of the file to save
   * @param data - Data to save
   */
  public async save(name: string, data: string): Promise<void> {
    const existingFileId = await this.findFileId(name)
    try {
      if (existingFileId) {
        const url = `${this.uploadUrl}/files/${existingFileId}?uploadType=media`
        await this.request(url, {
          method: 'PATCH',
          headers: {
            'Content-Type': 'text/plain'
          },
          body: data
        })
      } else {
        const metadata = {
          name,
          parents: ['appDataFolder'],
          mimeType: 'text/plain'
        }
        const boundary = '-------314159265358979323846'
        const multipartRequestBody = [
          `--${boundary}`,
          'Content-Type: application/json; charset=UTF-8',
          '',
          JSON.stringify(metadata),
          `--${boundary}`,
          'Content-Type: text/plain',
          '',
          data,
          `--${boundary}--`
        ].join('\r\n')
        const url = `${this.uploadUrl}/files?uploadType=multipart`
        await this.request(url, {
          method: 'POST',
          headers: {
            'Content-Type': `multipart/related; boundary=${boundary}`
          },
          body: multipartRequestBody
        })
      }
    } catch (error) {
      throw new GoogleDriveError(`Failed to save file '${name}': ${error instanceof Error ? error.message : error}`)
    }
  }

  /**
   * Deletes a file from Google Drive's appDataFolder.
   * @param name - Name of the file to delete
   * @throws {GoogleDriveError} If the file doesn't exist or cannot be deleted
   */
  public async delete(name: string): Promise<void> {
    const fileId = await this.findFileId(name)
    if (!fileId) throw new StorageFileNotFoundError(`File '${name}' not found in Google Drive`)
    try {
      const url = `${this.baseUrl}/files/${fileId}`
      await this.request(url, {
        method: 'DELETE'
      })
    } catch (error) {
      throw new GoogleDriveError(`Failed to delete file '${name}': ${error instanceof Error ? error.message : error}`)
    }
  }

  /**
   * Checks if a file exists in Google Drive.
   * @param name - Name of the file to check
   * @returns true if the file exists, false otherwise
   */
  public async exists(name: string): Promise<boolean> {
    try {
      const fileId = await this.findFileId(name)
      return fileId !== null
    } catch {
      return false
    }
  }
}
