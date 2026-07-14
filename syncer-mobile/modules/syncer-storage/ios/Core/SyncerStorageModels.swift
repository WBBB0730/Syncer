import Foundation

internal struct StorageFileInput {
  let sourceUri: String
  let name: String
  let size: Int64
  let mimeType: String?
}

internal struct PublishedFile {
  let sourceUri: String
  let name: String
  let locator: String
}

internal struct StorageSaveResult {
  let file: PublishedFile
  let downloadsPath: String
}

internal enum SyncerStorageError: Error {
  case invalidFileName(String)
  case invalidSourceUri(String, Error? = nil)
  case invalidMimeType
  case sourceSizeMismatch(name: String, expected: Int64, actual: Int64)
  case notInitialized
  case unableToSave(Error? = nil)
  case unableToOpen(String, Error? = nil)
  case invalidLegacyLocator(String)
}

extension SyncerStorageError: LocalizedError {
  var errorDescription: String? {
    switch self {
    case .invalidFileName(let name):
      return "Invalid destination file name: '\(name)'."
    case .invalidSourceUri(let uri, _):
      return "Invalid or unreadable source URI: '\(uri)'."
    case .invalidMimeType:
      return "MIME type must not be empty."
    case .sourceSizeMismatch(let name, let expected, let actual):
      return "Source size changed for '\(name)': expected \(expected) bytes, copied \(actual) bytes."
    case .notInitialized:
      return "Syncer storage has not been initialized."
    case .unableToSave:
      return "Unable to save files to the Syncer documents directory."
    case .unableToOpen(let locator, _):
      return "Unable to open the saved file at '\(locator)'."
    case .invalidLegacyLocator(let locator):
      return "Invalid legacy saved-file locator: '\(locator)'."
    }
  }

  var underlyingError: Error? {
    switch self {
    case .invalidSourceUri(_, let error), .unableToSave(let error), .unableToOpen(_, let error):
      return error
    default:
      return nil
    }
  }
}

internal struct SyncerCompoundError: LocalizedError {
  let errors: [Error]

  var errorDescription: String? {
    errors.map { ($0 as NSError).localizedDescription }.joined(separator: "; ")
  }
}
