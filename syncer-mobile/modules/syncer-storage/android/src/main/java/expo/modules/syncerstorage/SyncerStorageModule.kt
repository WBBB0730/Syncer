package expo.modules.syncerstorage

import android.content.ContentResolver
import android.content.Intent
import android.net.Uri
import android.provider.OpenableColumns
import android.webkit.MimeTypeMap
import androidx.core.net.toUri
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.functions.Coroutine
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.util.Locale
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext

class SyncerStorageModule : Module() {
  private val saveMutex = Mutex()
  @Volatile
  private var storage: DownloadsStorage? = null

  override fun definition() = ModuleDefinition {
    Name("SyncerStorage")

    Constant("downloadsPath") {
      val context = appContext.reactContext ?: throw Exceptions.ReactContextLost()
      storage(context).downloadsPath
    }

    AsyncFunction("initializeAsync") Coroutine { ->
      val context = appContext.reactContext ?: throw Exceptions.ReactContextLost()
      withContext(Dispatchers.IO) {
        saveMutex.withLock { storage(context).initialize() }
      }
    }

    AsyncFunction("saveFileAsync") Coroutine { file: SaveFileInput ->
      val context = appContext.reactContext ?: throw Exceptions.ReactContextLost()

      withContext(Dispatchers.IO) {
        saveMutex.withLock {
          storage(context).saveFile(file)
        }
      }
    }

    AsyncFunction("migrateLegacyFileLocatorAsync") Coroutine {
        uri: String?, path: String?, name: String ->
      val context = appContext.reactContext ?: throw Exceptions.ReactContextLost()
      withContext(Dispatchers.IO) {
        storage(context).migrateLegacyFileLocator(uri, path, name)
      }
    }

    AsyncFunction("openFileAsync") Coroutine { locator: String ->
      val context = appContext.reactContext ?: throw Exceptions.ReactContextLost()
      val (target, mimeType) = withContext(Dispatchers.IO) {
        try {
          val resolvedLocator = storage(context).resolveOpenLocator(locator)
          val target = resolveOpenTarget(resolvedLocator)
          target to resolveOpenMimeType(context.contentResolver, target)
        } catch (exception: UnableToOpenFileException) {
          throw exception
        } catch (exception: Exception) {
          throw UnableToOpenFileException(exception)
        }
      }

      val intent = Intent(Intent.ACTION_VIEW).apply {
        setDataAndType(target.uri, mimeType)
        addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_ACTIVITY_NEW_TASK)
      }
      withContext(Dispatchers.Main) {
        try {
          context.startActivity(intent)
        } catch (exception: Exception) {
          throw UnableToOpenFileException(exception)
        }
      }
    }
  }

  private fun storage(context: android.content.Context): DownloadsStorage =
    storage ?: synchronized(this) {
      storage ?: DownloadsStorage(AndroidDownloadsPlatform(context)).also { storage = it }
    }
}

private fun resolveOpenTarget(value: String): OpenTarget {
  if (value.isBlank()) throw UnableToOpenFileException()

  val parsedUri = value.toUri()
  if (parsedUri.scheme != ContentResolver.SCHEME_CONTENT) throw UnableToOpenFileException()
  return OpenTarget(parsedUri, null)
}

private fun resolveOpenMimeType(contentResolver: ContentResolver, target: OpenTarget): String {
  val resolvedMimeType = contentResolver.getType(target.uri)
  if (resolvedMimeType != null) return resolveMimeType(resolvedMimeType, null)

  val displayName = target.fileName ?: queryDisplayName(contentResolver, target.uri)
  val inferredMimeType = displayName
    ?.let(::fileExtension)
    ?.lowercase(Locale.ROOT)
    ?.let(MimeTypeMap.getSingleton()::getMimeTypeFromExtension)

  return resolveMimeType(null, inferredMimeType)
}

private fun queryDisplayName(contentResolver: ContentResolver, uri: Uri): String? {
  val cursor = contentResolver.query(
    uri,
    arrayOf(OpenableColumns.DISPLAY_NAME),
    null,
    null,
    null
  ) ?: return null

  return cursor.use {
    if (!it.moveToFirst()) return@use null
    it.getString(it.getColumnIndexOrThrow(OpenableColumns.DISPLAY_NAME))
  }
}

private data class OpenTarget(
  val uri: Uri,
  val fileName: String?
)
