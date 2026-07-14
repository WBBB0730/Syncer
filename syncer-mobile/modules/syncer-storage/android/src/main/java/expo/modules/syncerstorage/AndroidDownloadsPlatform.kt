package expo.modules.syncerstorage

import android.content.ContentResolver
import android.content.ContentUris
import android.content.ContentValues
import android.content.Context
import android.net.Uri
import android.os.Environment
import android.provider.MediaStore
import android.webkit.MimeTypeMap
import androidx.core.net.toUri
import java.io.File
import java.io.FileInputStream
import java.io.InputStream
import java.io.OutputStream
import java.util.Locale

private const val DIRECTORY_NAME = "Syncer"
private val RELATIVE_DOWNLOADS_PATH = "${Environment.DIRECTORY_DOWNLOADS}/$DIRECTORY_NAME/"

internal class AndroidDownloadsPlatform(context: Context) : DownloadsPlatform {
  private val context = context.applicationContext
  private val contentResolver = context.contentResolver

  @Suppress("DEPRECATION")
  private val legacyDownloadsDirectory = File(
    Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS),
    DIRECTORY_NAME
  )

  override val downloadsPath: String
    get() = RELATIVE_DOWNLOADS_PATH

  override fun inferMimeType(name: String): String? = fileExtension(name)
    ?.lowercase(Locale.ROOT)
    ?.let(MimeTypeMap.getSingleton()::getMimeTypeFromExtension)

  override fun openSource(sourceUri: String): InputStream {
    val uri = sourceUri.toUri()
    return try {
      when (uri.scheme) {
        ContentResolver.SCHEME_CONTENT -> contentResolver.openInputStream(uri)
          ?: throw InvalidSourceUriException(sourceUri)

        ContentResolver.SCHEME_FILE -> uri.path
          ?.let(::File)
          ?.let(::FileInputStream)
          ?: throw InvalidSourceUriException(sourceUri)

        else -> throw InvalidSourceUriException(sourceUri)
      }
    } catch (exception: InvalidSourceUriException) {
      throw exception
    } catch (exception: Exception) {
      throw InvalidSourceUriException(sourceUri, exception)
    }
  }

  override fun mediaStoreFileExists(name: String): Boolean {
    val cursor = contentResolver.query(
      downloadsCollection,
      arrayOf(MediaStore.Downloads._ID),
      "${MediaStore.Downloads.RELATIVE_PATH} = ? AND ${MediaStore.Downloads.DISPLAY_NAME} = ?",
      arrayOf(RELATIVE_DOWNLOADS_PATH, name),
      null
    ) ?: throw StorageUnavailableException()
    return cursor.use { it.moveToFirst() }
  }

  override fun insertPendingDownload(name: String, mimeType: String): String {
    val values = ContentValues().apply {
      put(MediaStore.Downloads.DISPLAY_NAME, name)
      put(MediaStore.Downloads.MIME_TYPE, mimeType)
      put(MediaStore.Downloads.RELATIVE_PATH, RELATIVE_DOWNLOADS_PATH)
      put(MediaStore.Downloads.IS_PENDING, 1)
    }
    return contentResolver.insert(downloadsCollection, values)?.toString()
      ?: throw StorageUnavailableException()
  }

  override fun queryMediaStoreDisplayName(locator: String): String {
    val cursor = contentResolver.query(
      locator.toUri(),
      arrayOf(MediaStore.Downloads.DISPLAY_NAME),
      null,
      null,
      null
    ) ?: throw StorageUnavailableException()
    return cursor.use {
      if (!it.moveToFirst()) throw StorageUnavailableException()
      it.getString(it.getColumnIndexOrThrow(MediaStore.Downloads.DISPLAY_NAME))
    }
  }

  override fun openPendingDownload(locator: String): OutputStream =
    contentResolver.openOutputStream(locator.toUri(), "w") ?: throw StorageUnavailableException()

  override fun publishPendingDownload(locator: String) {
    val values = ContentValues().apply { put(MediaStore.Downloads.IS_PENDING, 0) }
    if (contentResolver.update(locator.toUri(), values, null, null) != 1) {
      throw StorageUnavailableException()
    }
  }

  override fun queryMediaStoreState(locator: String): MediaStoreState {
    val cursor = contentResolver.query(
      locator.toUri(),
      arrayOf(MediaStore.Downloads.IS_PENDING),
      null,
      null,
      null
    ) ?: throw StorageUnavailableException()
    return cursor.use {
      if (!it.moveToFirst()) return@use MediaStoreState.Absent
      val column = it.getColumnIndexOrThrow(MediaStore.Downloads.IS_PENDING)
      if (it.isNull(column)) throw StorageUnavailableException()
      when (it.getInt(column)) {
        0 -> MediaStoreState.Published
        1 -> MediaStoreState.Pending
        else -> throw StorageUnavailableException()
      }
    }
  }

  override fun deleteMediaStoreEntry(locator: String) {
    contentResolver.delete(locator.toUri(), null, null)
  }

  override fun listOwnedPendingDownloads(): List<String> = storageOperation {
    val cursor = contentResolver.query(
      downloadsCollection,
      arrayOf(MediaStore.Downloads._ID),
      "${MediaStore.Downloads.RELATIVE_PATH} = ? AND " +
        "${MediaStore.Downloads.IS_PENDING} = ? AND " +
        "${MediaStore.Downloads.OWNER_PACKAGE_NAME} = ?",
      arrayOf(RELATIVE_DOWNLOADS_PATH, "1", context.packageName),
      null
    ) ?: throw StorageUnavailableException()
    cursor.use {
      val idColumn = it.getColumnIndexOrThrow(MediaStore.Downloads._ID)
      buildList {
        while (it.moveToNext()) {
          add(ContentUris.withAppendedId(downloadsCollection, it.getLong(idColumn)).toString())
        }
      }
    }
  }

  override fun deleteOwnedPendingDownload(locator: String) = storageOperation {
    if (contentResolver.delete(locator.toUri(), null, null) != 1) {
      throw StorageUnavailableException()
    }
  }

  override fun migrateLegacyFileLocator(uri: String?, path: String?, name: String): String =
    migrateAndroidLegacyLocator(
      uriString = uri,
      path = path,
      name = name,
      downloadsDirectory = legacyDownloadsDirectory,
      contentLocator = { file -> file.name }
    )

  override fun resolveOpenLocator(locator: String): String {
    if (locator.startsWith("content:")) return validateAndroidContentLocator(locator)

    val name = validateAndroidLegacyLocator(locator)
    return ownedPublishedDownloadLocator(name)
  }

  private fun ownedPublishedDownloadLocator(name: String): String = storageOperation {
    val cursor = contentResolver.query(
      downloadsCollection,
      arrayOf(MediaStore.Downloads._ID),
      "${MediaStore.Downloads.RELATIVE_PATH} = ? AND " +
        "${MediaStore.Downloads.DISPLAY_NAME} = ? AND " +
        "(${MediaStore.Downloads.OWNER_PACKAGE_NAME} = ? OR " +
        "${MediaStore.Downloads.OWNER_PACKAGE_NAME} IS NULL) AND " +
        "${MediaStore.Downloads.IS_PENDING} = ?",
      arrayOf(RELATIVE_DOWNLOADS_PATH, name, context.packageName, "0"),
      null
    ) ?: throw UnableToOpenFileException()
    cursor.use {
      if (!it.moveToFirst()) throw UnableToOpenFileException()
      val uri = ContentUris.withAppendedId(
        downloadsCollection,
        it.getLong(it.getColumnIndexOrThrow(MediaStore.Downloads._ID))
      )
      contentResolver.openFileDescriptor(uri, "r")?.use { } ?: throw UnableToOpenFileException()
      uri.toString()
    }
  }

  private val downloadsCollection: Uri
    get() = MediaStore.Downloads.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY)
}

private inline fun <T> storageOperation(operation: () -> T): T = try {
  operation()
} catch (exception: StorageUnavailableException) {
  throw exception
} catch (exception: Exception) {
  throw StorageUnavailableException(exception)
}
