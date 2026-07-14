package expo.modules.syncerstorage

import expo.modules.kotlin.exception.CodedException

internal class StorageNotInitializedException :
  CodedException("Syncer storage has not been initialized.")

internal class InvalidFileNameException(name: String) :
  CodedException("Invalid destination file name: '$name'.")

internal class InvalidSourceUriException(uri: String, cause: Throwable? = null) :
  CodedException("Invalid or unreadable source URI: '$uri'.", cause)

internal class InvalidMimeTypeException(name: String) :
  CodedException("Missing or invalid MIME type for '$name'.")

internal class SourceSizeMismatchException(name: String, expected: Long, actual: Long) :
  CodedException("Source size changed for '$name': expected $expected bytes, copied $actual bytes.")

internal class StorageUnavailableException(cause: Throwable? = null) :
  CodedException("The public Downloads directory is unavailable.", cause)

internal class UnableToOpenFileException(cause: Throwable? = null) :
  CodedException("Unable to open the saved file.", cause)

internal class UnableToSaveFilesException(cause: Exception) :
  CodedException("Unable to save files to the public Downloads directory.", cause)

internal class IncompleteRollbackException(details: String, cause: Exception) :
  CodedException("Unable to remove incomplete saved files: $details.", cause)
