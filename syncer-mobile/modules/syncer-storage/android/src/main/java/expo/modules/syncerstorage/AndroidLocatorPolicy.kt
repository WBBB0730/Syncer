package expo.modules.syncerstorage

import java.io.File
import java.net.URI

internal fun migrateAndroidLegacyLocator(
  uriString: String?,
  path: String?,
  name: String,
  downloadsDirectory: File,
  contentLocator: (File) -> String
): String {
  try {
    PortableBasenamePolicy.validate(name)
  } catch (exception: IllegalArgumentException) {
    throw UnableToOpenFileException()
  }

  val uri = uriString?.let {
    try {
      URI(it)
    } catch (exception: Exception) {
      throw UnableToOpenFileException(exception)
    }
  }
  if (uri?.scheme == "content") {
    if (path != null) throw UnableToOpenFileException()
    return uri.toString()
  }
  if (uri != null && uri.scheme != "file") throw UnableToOpenFileException()

  val candidates = buildList {
    uri?.let {
      try {
        add(File(it).canonicalFile)
      } catch (exception: Exception) {
        throw UnableToOpenFileException(exception)
      }
    }
    path?.let {
      val file = File(it)
      if (!file.isAbsolute) throw UnableToOpenFileException()
      add(file.canonicalFile)
    }
    if (uri == null && path == null) {
      add(File(downloadsDirectory, name).canonicalFile)
    }
  }
  if (candidates.isEmpty()) throw UnableToOpenFileException()

  val expectedDirectory = downloadsDirectory.canonicalFile
  if (candidates.any { it.name != name || it.parentFile != expectedDirectory }) {
    throw UnableToOpenFileException()
  }
  val file = candidates.first()
  if (candidates.any { it != file }) throw UnableToOpenFileException()
  return contentLocator(file)
}

internal fun validateAndroidContentLocator(locator: String): String {
  val uri = try {
    URI(locator)
  } catch (exception: Exception) {
    throw UnableToOpenFileException(exception)
  }
  if (uri.scheme != "content") throw UnableToOpenFileException()
  return uri.toString()
}

internal fun validateAndroidLegacyLocator(locator: String): String {
  try {
    PortableBasenamePolicy.validate(locator)
  } catch (exception: IllegalArgumentException) {
    throw UnableToOpenFileException(exception)
  }
  return locator
}
