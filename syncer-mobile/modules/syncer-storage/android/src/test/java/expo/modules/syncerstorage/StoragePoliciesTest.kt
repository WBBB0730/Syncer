package expo.modules.syncerstorage

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test

class StoragePoliciesTest {
  @Test
  fun `portable basename policy matches shared boundary vectors`() {
    val invalidNames = listOf(
      "", ".", "..", "../secret.txt", "folder/file.txt", "folder\\file.txt",
      "CON", "CON .txt", "lpt1.log", "trailing.", "trailing ",
      "COM¹.txt", "com²", "CoM³.log",
      "LPT¹.txt", "lpt²", "LpT³.log",
      "bad\u0000name", "bad\u0085name", "invoice\u202efdp.exe",
      "bad<name", "bad>name", "bad:name", "bad\"name", "bad|name", "bad?name", "bad*name"
    )
    invalidNames.forEach { name ->
      assertThrows(IllegalArgumentException::class.java) {
        PortableBasenamePolicy.validate(name)
      }
    }

    val validNames = listOf(
      ".env",
      "\u62a5\u544a 1.txt",
      "conduit.txt",
      "lpt10.txt",
      "\u5bb6\u5ead\u200d\u6210\u5458.txt"
    )
    validNames.forEach(PortableBasenamePolicy::validate)

    PortableBasenamePolicy.validate("\u6587".repeat(85))
    assertThrows(IllegalArgumentException::class.java) {
      PortableBasenamePolicy.validate("\u6587".repeat(86))
    }
  }

  @Test
  fun `keeps a name at the byte limit unchanged`() {
    val name = "a".repeat(251) + ".txt"

    assertEquals(name, collisionName(name, 0))
    assertEquals(MAX_FILE_NAME_BYTES, collisionName(name, 0).utf8Size())
  }

  @Test
  fun `truncates the stem before adding a collision suffix`() {
    val name = "a".repeat(251) + ".txt"
    val result = collisionName(name, 1)

    assertEquals("a".repeat(247) + " (1).txt", result)
    assertEquals(MAX_FILE_NAME_BYTES, result.utf8Size())
  }

  @Test
  fun `never splits a multi-byte code point`() {
    val result = collisionName("文".repeat(83) + ".txt", 1)

    assertEquals(MAX_FILE_NAME_BYTES - 1, result.utf8Size())
    assertTrue(result.endsWith(" (1).txt"))
    assertFalse(result.contains('\uFFFD'))
  }

  @Test
  fun `matches TextEncoder replacement bytes for an unpaired surrogate`() {
    val malformed = "\uD800"

    assertEquals(3, malformed.utf8Size())
    assertEquals("", malformed.truncateUtf8(2))
    assertEquals(malformed, malformed.truncateUtf8(3))
  }

  @Test
  fun `treats a leading dot as part of the stem`() {
    assertEquals(".syncer (1)", collisionName(".syncer", 1))
    assertNull(fileExtension(".syncer"))
  }

  @Test
  fun `fits an extension before fitting the stem`() {
    val extension = "." + "a".repeat(250)
    val result = collisionName("x$extension", 1)

    assertEquals(MAX_FILE_NAME_BYTES, result.utf8Size())
    assertTrue(result.startsWith(" (1)."))
  }

  @Test
  fun `extracts only a non-empty conventional extension`() {
    assertEquals("json", fileExtension("archive.data.json"))
    assertNull(fileExtension("README"))
    assertNull(fileExtension("file."))
  }

  @Test
  fun `treats a leading dot as a stem and rejects a trailing dot`() {
    assertEquals(".env (1)", collisionName(".env", 1))
    assertThrows(IllegalArgumentException::class.java) {
      collisionName("file.", 1)
    }
  }

  @Test
  fun `removes a partial trailing dot or space from a fitted extension`() {
    val result = collisionName("xx.${"a".repeat(249)} bc", 1)

    assertEquals(MAX_FILE_NAME_BYTES, result.utf8Size())
    assertEquals("x (1).${"a".repeat(249)}", result)
    assertFalse(result.endsWith('.') || result.endsWith(' '))
  }

  @Test
  fun `rejects an initial name over the portable byte limit`() {
    assertThrows(IllegalArgumentException::class.java) {
      collisionName("文".repeat(86), 0)
    }
  }

  @Test
  fun `accepts concrete MIME type and subtype tokens`() {
    assertTrue(isValidMimeType("application/vnd.syncer+json"))
    assertTrue(isValidMimeType("application/vnd.syncer~json"))
    assertTrue(isValidMimeType("!#$%&'*+.^_`|~-token/type"))
    assertTrue(isValidMimeType("IMAGE/JPEG"))
    assertTrue(isValidMimeType("*/*"))
    assertEquals("text/plain", resolveMimeType(null, "text/plain"))
    assertEquals(DEFAULT_MIME_TYPE, resolveMimeType(null, null))
  }

  @Test
  fun `rejects parameterized and malformed MIME types`() {
    assertFalse(isValidMimeType("text/plain; charset=utf-8"))
    assertFalse(isValidMimeType("text"))
    assertFalse(isValidMimeType("/plain"))
    assertFalse(isValidMimeType("text/"))
    assertThrows(IllegalArgumentException::class.java) {
      resolveMimeType("invalid", "text/plain")
    }
  }

  @Test
  fun `enforces the MIME component length boundary`() {
    assertTrue(isValidMimeType("a/${"b".repeat(253)}"))
    assertFalse(isValidMimeType("a/${"b".repeat(254)}"))
  }
}
