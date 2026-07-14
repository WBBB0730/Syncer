package expo.modules.syncerstorage

import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.io.File
import java.io.InputStream
import java.io.OutputStream
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test

class DownloadsStorageTest {
  @Test
  fun `MediaStore publication inserts pending copies exact bytes and finalizes`() {
    val platform = FakeDownloadsPlatform()
    val sourceUri = "content://source/report"
    val bytes = ByteArray(200_000) { index -> (index % 251).toByte() }
    platform.sources[sourceUri] = bytes

    val result = initializedStorage(platform).saveFile(
      input(sourceUri, "report.unknown", bytes.size)
    )

    assertEquals("Download/Syncer/", result.downloadsPath)
    assertEquals(sourceUri, result.file.sourceUri)
    assertEquals("content://media/1", result.file.locator)
    assertEquals(DEFAULT_MIME_TYPE, platform.insertedMimeTypes.single())
    assertArrayEquals(bytes, platform.publishedBytes("content://media/1"))
    assertEquals(
      listOf("insert:report.unknown", "open:content://media/1", "finalize:content://media/1"),
      platform.events.filter { it.startsWith("insert:") || it.startsWith("open:") || it.startsWith("finalize:") }
    )
  }

  @Test
  fun `MediaStore failure removes the pending row`() {
    val platform = FakeDownloadsPlatform()
    platform.sources["content://source/short"] = byteArrayOf(1, 2)
    val storage = initializedStorage(platform)

    assertThrows(SourceSizeMismatchException::class.java) {
      storage.saveFile(input("content://source/short", "short.bin", 3))
    }

    assertTrue(platform.pending.isEmpty())
    assertTrue(platform.published.isEmpty())
    assertTrue(platform.events.contains("delete:content://media/1"))
  }

  @Test
  fun `MediaStore publication uses the next collision name`() {
    val platform = FakeDownloadsPlatform()
    platform.sources["content://source/report"] = "new".toByteArray()
    platform.published["content://media/existing"] = FakeMediaEntry(
      name = "report.txt",
      bytes = "existing".toByteArray()
    )

    val result = initializedStorage(platform).saveFile(
      input("content://source/report", "report.txt", 3)
    )

    assertEquals("report (1).txt", result.file.name)
    assertArrayEquals("existing".toByteArray(), platform.publishedBytes("content://media/existing"))
    assertArrayEquals("new".toByteArray(), platform.publishedBytes(result.file.locator))
  }

  @Test
  fun `legacy history migration defers MediaStore lookup until the file is opened`() {
    val platform = FakeDownloadsPlatform()
    platform.published["content://media/old-report"] = FakeMediaEntry("old report.txt")
    platform.published["content://media/legacy"] = FakeMediaEntry("legacy.bin")
    val storage = DownloadsStorage(platform)

    val nameOnly = storage.migrateLegacyFileLocator(null, null, "old report.txt")
    assertEquals("old report.txt", nameOnly)
    assertEquals("content://media/old-report", storage.resolveOpenLocator(nameOnly))

    val mediaStore = storage.migrateLegacyFileLocator("content://media/external/downloads/7", null, "new.bin")
    assertEquals("content://media/external/downloads/7", mediaStore)
    assertEquals(mediaStore, storage.resolveOpenLocator(mediaStore))

    val legacyFile = File(platform.legacyDownloadsDirectory, "legacy.bin")
    val fileLocator = storage.migrateLegacyFileLocator(
      legacyFile.toURI().toString(),
      legacyFile.absolutePath,
      "legacy.bin"
    )
    assertEquals("legacy.bin", fileLocator)
    assertEquals("content://media/legacy", storage.resolveOpenLocator(fileLocator))
    assertThrows(UnableToOpenFileException::class.java) {
      storage.migrateLegacyFileLocator(null, null, "../escape.bin")
    }
    assertThrows(UnableToOpenFileException::class.java) {
      storage.migrateLegacyFileLocator(null, null, "CON")
    }
    val missing = storage.migrateLegacyFileLocator(null, null, "missing.bin")
    assertEquals("missing.bin", missing)
    assertThrows(UnableToOpenFileException::class.java) { storage.resolveOpenLocator(missing) }
  }

  @Test
  fun `initialization removes only app-owned pending downloads in the Syncer directory`() {
    val platform = FakeDownloadsPlatform()
    platform.addPendingDownload("content://media/owned", "owned.bin")
    platform.addPendingDownload(
      "content://media/other-directory",
      "other.bin",
      relativePath = "Download/Other/"
    )
    platform.addPendingDownload(
      "content://media/other-owner",
      "foreign.bin",
      ownerPackageName = "com.example.foreign"
    )
    platform.published["content://media/published"] = FakeMediaEntry("published.bin")

    DownloadsStorage(platform).initialize()

    assertFalse(platform.pending.containsKey("content://media/owned"))
    assertTrue(platform.pending.containsKey("content://media/other-directory"))
    assertTrue(platform.pending.containsKey("content://media/other-owner"))
    assertTrue(platform.published.containsKey("content://media/published"))
    assertEquals(
      listOf("list-pending", "cleanup-pending:content://media/owned"),
      platform.events
    )
  }

  @Test
  fun `failed pending cleanup is explicit and prevents publication`() {
    val platform = FakeDownloadsPlatform().apply {
      addPendingDownload("content://media/owned", "owned.bin")
      failPendingCleanup = true
    }
    val storage = DownloadsStorage(platform)

    assertThrows(StorageUnavailableException::class.java) {
      storage.initialize()
    }
    assertThrows(StorageNotInitializedException::class.java) {
      storage.saveFile(input("content://source/new", "new.bin", 1))
    }
    assertFalse(platform.events.any { it.startsWith("insert:") })
  }

  private fun input(sourceUri: String, name: String, size: Int) = SaveFileInput(
    sourceUri = sourceUri,
    name = name,
    size = size.toLong(),
    mimeType = null
  )

  private fun initializedStorage(platform: FakeDownloadsPlatform): DownloadsStorage =
    DownloadsStorage(platform).also { it.initialize() }
}

private class FakeDownloadsPlatform : DownloadsPlatform {
  override val downloadsPath = "Download/Syncer/"
  val legacyDownloadsDirectory = File("/storage/emulated/0/Download/Syncer")
  val sources = mutableMapOf<String, ByteArray>()
  val pending = mutableMapOf<String, FakeMediaEntry>()
  val published = mutableMapOf<String, FakeMediaEntry>()
  val events = mutableListOf<String>()
  val insertedMimeTypes = mutableListOf<String>()
  var failPendingCleanup = false
  private var nextMediaId = 1

  override fun inferMimeType(name: String): String? = null

  override fun openSource(sourceUri: String): InputStream = ByteArrayInputStream(
    sources[sourceUri] ?: throw InvalidSourceUriException(sourceUri)
  )

  override fun mediaStoreFileExists(name: String): Boolean =
    (pending.values + published.values).any { it.name == name }

  override fun insertPendingDownload(name: String, mimeType: String): String {
    val locator = "content://media/${nextMediaId++}"
    pending[locator] = FakeMediaEntry(name)
    insertedMimeTypes += mimeType
    events += "insert:$name"
    return locator
  }

  override fun queryMediaStoreDisplayName(locator: String): String =
    (pending[locator] ?: published[locator] ?: throw StorageUnavailableException()).name

  override fun openPendingDownload(locator: String): OutputStream {
    val entry = pending[locator] ?: throw StorageUnavailableException()
    events += "open:$locator"
    return object : ByteArrayOutputStream() {
      override fun close() {
        super.close()
        entry.bytes = toByteArray()
      }
    }
  }

  override fun publishPendingDownload(locator: String) {
    val entry = pending.remove(locator) ?: throw StorageUnavailableException()
    published[locator] = entry
    events += "finalize:$locator"
  }

  override fun queryMediaStoreState(locator: String): MediaStoreState = when {
    locator in pending -> MediaStoreState.Pending
    locator in published -> MediaStoreState.Published
    else -> MediaStoreState.Absent
  }

  override fun deleteMediaStoreEntry(locator: String) {
    pending.remove(locator)
    published.remove(locator)
    events += "delete:$locator"
  }

  override fun listOwnedPendingDownloads(): List<String> {
    events += "list-pending"
    return pending
      .filterValues { entry ->
        entry.relativePath == "Download/Syncer/" && entry.ownerPackageName == "com.syncer"
      }
      .keys
      .toList()
  }

  override fun deleteOwnedPendingDownload(locator: String) {
    events += "cleanup-pending:$locator"
    if (failPendingCleanup) throw StorageUnavailableException()
    if (pending.remove(locator) == null) throw StorageUnavailableException()
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
    return published.entries.firstOrNull { it.value.name == name }?.key
      ?: throw UnableToOpenFileException()
  }

  fun publishedBytes(locator: String): ByteArray = published.getValue(locator).bytes

  fun addPendingDownload(
    locator: String,
    name: String,
    relativePath: String = "Download/Syncer/",
    ownerPackageName: String = "com.syncer"
  ) {
    pending[locator] = FakeMediaEntry(name, relativePath = relativePath, ownerPackageName = ownerPackageName)
  }

}

private data class FakeMediaEntry(
  val name: String,
  var bytes: ByteArray = byteArrayOf(),
  val relativePath: String = "Download/Syncer/",
  val ownerPackageName: String = "com.syncer"
)
