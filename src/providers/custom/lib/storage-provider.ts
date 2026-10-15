/*
 * Generic external storage provider interface for the Aioha external wallet provider.
 */

/**
 * Error thrown by storage providers when a requested file does not exist.
 * Used by the external wallet provider to distinguish missing wallet files
 * from other storage failures.
 */
export class StorageFileNotFoundError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'StorageFileNotFoundError'
  }
}

/**
 * Abstract base class for external storage providers used by the external wallet provider.
 * Only Google Drive is supported out of the box (see GoogleStorageProvider), but custom
 * implementations may be provided via the `storage` option of ExternalWalletProvider.
 */
export abstract class AStorageProviderBase {
  /**
   * Retrieves the content of a file from external storage.
   * @param name - Name of the file to retrieve
   * @throws {StorageFileNotFoundError} If the file does not exist
   */
  public abstract get(name: string): Promise<string>
  /**
   * Saves data to a file in external storage.
   * @param name - Name of the file to save
   * @param data - Data to save
   */
  public abstract save(name: string, data: string): Promise<void>
  /**
   * Deletes a file from external storage.
   * @param name - Name of the file to delete
   * @throws {StorageFileNotFoundError} If the file does not exist
   */
  public abstract delete(name: string): Promise<void>
  /**
   * Checks if a file exists in external storage.
   * @param name - Name of the file to check
   */
  public abstract exists(name: string): Promise<boolean>
}
