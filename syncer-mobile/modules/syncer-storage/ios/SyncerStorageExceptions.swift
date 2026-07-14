import ExpoModulesCore

internal final class InvalidFileNameException: GenericException<String> {
  override var reason: String {
    "Invalid destination file name: '\(param)'."
  }
}

internal final class InvalidSourceUriException: GenericException<String> {
  override var reason: String {
    "Invalid or unreadable source URI: '\(param)'."
  }
}

internal final class InvalidMimeTypeException: Exception {
  override var reason: String {
    "MIME type must not be empty."
  }
}

internal final class SourceSizeMismatchException:
  GenericException<(name: String, expected: Int64, actual: Int64)> {
  override var reason: String {
    "Source size changed for '\(param.name)': expected \(param.expected) bytes, copied \(param.actual) bytes."
  }
}

internal final class UnableToSaveFilesException: Exception {
  override var reason: String {
    "Unable to save files to the Syncer documents directory."
  }
}

internal final class UnableToOpenFileException: GenericException<String> {
  override var reason: String {
    "Unable to open the saved file at '\(param)'."
  }
}

internal final class PreviewInProgressException: Exception {
  override var reason: String {
    "A saved file preview is already open."
  }
}
