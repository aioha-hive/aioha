/**
 * Minimal external storage interface used by the Google Drive provider.
 * Implement this interface to store the encrypted wallet file somewhere else.
 */
export interface WalletStorage {
  /** Retrieves a file's contents. Throws {@link StorageFileNotFoundError} when it does not exist. */
  get(name: string): Promise<string>
  /** Saves a file's contents, creating or replacing it. */
  save(name: string, data: string): Promise<void>
  /** Deletes a file. Throws {@link StorageFileNotFoundError} when it does not exist. */
  delete(name: string): Promise<void>
  /** Checks whether a file exists. */
  exists(name: string): Promise<boolean>
}

/** Thrown by storage providers when a requested file does not exist. */
export class StorageFileNotFoundError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'StorageFileNotFoundError'
  }
}
