package expo.modules.syncerstorage

import expo.modules.kotlin.exception.CodedException
import java.io.BufferedInputStream
import java.io.BufferedOutputStream
import java.io.InputStream
import java.io.OutputStream

internal class DownloadsStorage(
  private val platform: DownloadsPlatform
) {
  private var initialized = false

  val downloadsPath: String
    get() = platform.downloadsPath

  fun initialize() {
    initialized = false
    cleanOwnedPendingDownloads()
    initialized = true
  }

  fun saveFile(file: SaveFileInput): SaveFileResult {
    if (!initialized) throw StorageNotInitializedException()
    return try {
      cleanOwnedPendingDownloads()
      val preparedFile = prepareInput(file)
      SaveFileResult(
        file = toSavedFile(publishFile(preparedFile)),
        downloadsPath = downloadsPath
      )
    } catch (exception: CodedException) {
      throw exception
    } catch (exception: Exception) {
      throw UnableToSaveFilesException(exception)
    }
  }

  fun migrateLegacyFileLocator(uri: String?, path: String?, name: String): String =
    platform.migrateLegacyFileLocator(uri, path, name)

  fun resolveOpenLocator(locator: String): String = platform.resolveOpenLocator(locator)

  private fun cleanOwnedPendingDownloads() {
    platform.listOwnedPendingDownloads().forEach(platform::deleteOwnedPendingDownload)
  }

  private fun publishFile(file: PreparedFile): MediaStoreEntry {
    var entry: MediaStoreEntry? = null
    var readyToPublish = false

    try {
      val requestedName = findAvailableMediaStoreName(file.input.name)
      val locator = platform.insertPendingDownload(requestedName, file.mimeType)
      entry = MediaStoreEntry(file, locator, requestedName)
      entry.name = platform.queryMediaStoreDisplayName(locator)

      val copiedBytes = copySource(file.input.sourceUri, platform.openPendingDownload(locator))
      if (copiedBytes != file.input.size) {
        throw SourceSizeMismatchException(file.input.name, file.input.size, copiedBytes)
      }
      readyToPublish = true
      platform.publishPendingDownload(locator)
      return entry
    } catch (exception: Exception) {
      return recoverMediaStoreFile(entry, readyToPublish, exception)
    }
  }

  private fun recoverMediaStoreFile(
    entry: MediaStoreEntry?,
    readyToPublish: Boolean,
    originalException: Exception
  ): MediaStoreEntry {
    entry ?: throw originalException

    val initialState = try {
      platform.queryMediaStoreState(entry.locator)
    } catch (exception: Exception) {
      throw incompleteRollback(
        "the current row state could not be verified for ${entry.name}",
        originalException,
        listOf(exception)
      )
    }
    if (initialState == MediaStoreState.Absent) throw originalException
    if (initialState == MediaStoreState.Published && readyToPublish) return entry

    val cleanupFailures = mutableListOf<Exception>()
    try {
      platform.deleteMediaStoreEntry(entry.locator)
    } catch (exception: Exception) {
      cleanupFailures += exception
    }

    val finalState = try {
      platform.queryMediaStoreState(entry.locator)
    } catch (exception: Exception) {
      throw incompleteRollback(
        "the current row state could not be verified after cleanup for ${entry.name}",
        originalException,
        cleanupFailures + exception
      )
    }
    if (finalState == MediaStoreState.Absent) {
      cleanupFailures.forEach(originalException::addSuppressed)
      throw originalException
    }
    if (finalState == MediaStoreState.Published && readyToPublish) return entry

    val details = when (finalState) {
      MediaStoreState.Pending -> "a pending row remains for ${entry.name}"
      MediaStoreState.Published -> "an incomplete published row remains for ${entry.name}"
      MediaStoreState.Absent -> error("handled above")
    }
    throw incompleteRollback(details, originalException, cleanupFailures)
  }

  private fun findAvailableMediaStoreName(requestedName: String): String {
    var suffix = 0
    while (true) {
      val candidate = destinationName(requestedName, suffix)
      if (!platform.mediaStoreFileExists(candidate)) return candidate
      suffix += 1
    }
  }

  private fun copySource(sourceUri: String, outputStream: OutputStream): Long =
    BufferedInputStream(platform.openSource(sourceUri)).use { input ->
      BufferedOutputStream(outputStream).use { output ->
        val copiedBytes = input.copyTo(output, COPY_BUFFER_SIZE)
        output.flush()
        copiedBytes
      }
    }

  private fun prepareInput(file: SaveFileInput): PreparedFile {
    destinationName(file.name, 0)

    if (file.sourceUri.isBlank()) throw InvalidSourceUriException(file.sourceUri)
    if (file.size < 0) throw SourceSizeMismatchException(file.name, file.size, 0)

    val mimeType = try {
      resolveMimeType(file.mimeType, platform.inferMimeType(file.name))
    } catch (_: IllegalArgumentException) {
      throw InvalidMimeTypeException(file.name)
    }
    return PreparedFile(file, mimeType)
  }

  private fun destinationName(requestedName: String, suffix: Int): String = try {
    collisionName(requestedName, suffix)
  } catch (_: IllegalArgumentException) {
    throw InvalidFileNameException(requestedName)
  }

  private fun toSavedFile(file: MediaStoreEntry) = SavedFile(
    sourceUri = file.file.input.sourceUri,
    name = file.name,
    locator = file.locator
  )
}

internal const val COPY_BUFFER_SIZE = 64 * 1024

internal interface DownloadsPlatform {
  val downloadsPath: String

  fun inferMimeType(name: String): String?
  fun openSource(sourceUri: String): InputStream

  fun mediaStoreFileExists(name: String): Boolean
  fun insertPendingDownload(name: String, mimeType: String): String
  fun queryMediaStoreDisplayName(locator: String): String
  fun openPendingDownload(locator: String): OutputStream
  fun publishPendingDownload(locator: String)
  fun queryMediaStoreState(locator: String): MediaStoreState
  fun deleteMediaStoreEntry(locator: String)
  fun listOwnedPendingDownloads(): List<String>
  fun deleteOwnedPendingDownload(locator: String)

  fun migrateLegacyFileLocator(uri: String?, path: String?, name: String): String
  fun resolveOpenLocator(locator: String): String
}

internal enum class MediaStoreState {
  Absent,
  Pending,
  Published
}

private fun incompleteRollback(
  details: String,
  originalException: Exception,
  rollbackFailures: List<Exception>
): IncompleteRollbackException = IncompleteRollbackException(details, originalException).also { exception ->
  rollbackFailures.forEach(exception::addSuppressed)
}

private data class PreparedFile(
  val input: SaveFileInput,
  val mimeType: String
)

private data class MediaStoreEntry(
  val file: PreparedFile,
  val locator: String,
  var name: String
)
