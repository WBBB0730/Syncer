package expo.modules.syncerstorage

import android.net.Uri
import android.os.Build
import android.provider.MediaStore
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import java.io.File
import java.util.UUID
import org.junit.After
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class AndroidDownloadsPlatformInstrumentedTest {
  private val context = InstrumentationRegistry.getInstrumentation().targetContext
  private var publishedLocator: Uri? = null
  private var sourceFile: File? = null

  @After
  fun removePublishedFile() {
    publishedLocator?.let { context.contentResolver.delete(it, null, null) }
    sourceFile?.delete()
  }

  @Test
  fun publishesAndReopensExactBytesThroughMediaStoreDownloads() {
    assertTrue(Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q)
    val bytes = byteArrayOf(0, 1, 2, 3, 127, -1)
    val source = File.createTempFile("syncer-source-", ".bin", context.cacheDir).apply {
      writeBytes(bytes)
    }.also { sourceFile = it }
    val requestedName = "同步-${UUID.randomUUID()}.bin"
    val storage = DownloadsStorage(AndroidDownloadsPlatform(context))
    storage.initialize()

    val result = storage.saveFile(
      SaveFileInput(
        sourceUri = Uri.fromFile(source).toString(),
        name = requestedName,
        size = bytes.size.toLong(),
        mimeType = "application/octet-stream"
      )
    )
    val locator = Uri.parse(result.file.locator).also { publishedLocator = it }

    assertEquals(requestedName, result.file.name)
    assertEquals("Download/Syncer/", result.downloadsPath)
    assertEquals(locator.toString(), storage.resolveOpenLocator(locator.toString()))
    assertArrayEquals(bytes, context.contentResolver.openInputStream(locator)!!.use { it.readBytes() })

    context.contentResolver.query(
      locator,
      arrayOf(
        MediaStore.Downloads.DISPLAY_NAME,
        MediaStore.Downloads.RELATIVE_PATH,
        MediaStore.Downloads.IS_PENDING
      ),
      null,
      null,
      null
    )!!.use { cursor ->
      assertTrue(cursor.moveToFirst())
      assertEquals(requestedName, cursor.getString(0))
      assertEquals("Download/Syncer/", cursor.getString(1))
      assertEquals(0, cursor.getInt(2))
    }
  }
}
