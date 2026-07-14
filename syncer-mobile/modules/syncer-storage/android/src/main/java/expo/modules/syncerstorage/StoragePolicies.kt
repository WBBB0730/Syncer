package expo.modules.syncerstorage

import java.util.Locale

internal const val MAX_FILE_NAME_BYTES = 255
internal const val DEFAULT_MIME_TYPE = "application/octet-stream"

private val mimeTypeComponentPattern = Regex("[!#$%&'*+.^_`|~0-9A-Za-z-]+")

internal object PortableBasenamePolicy {
  private val forbiddenCodePoints = "<>:\"/\\|?*".mapTo(mutableSetOf()) { it.code }
  private val reservedNames = setOf(
    "con", "prn", "aux", "nul",
    "com1", "com2", "com3", "com4", "com5", "com6", "com7", "com8", "com9",
    "com¹", "com²", "com³",
    "lpt1", "lpt2", "lpt3", "lpt4", "lpt5", "lpt6", "lpt7", "lpt8", "lpt9",
    "lpt¹", "lpt²", "lpt³"
  )

  fun validate(name: String) {
    require(name.isNotEmpty())
    require(name != "." && name != "..")
    require(name.utf8Size() <= MAX_FILE_NAME_BYTES)
    require(!name.endsWith('.') && !name.endsWith(' '))
    require(!containsForbiddenCodePoint(name))

    val lowercased = name.lowercase(Locale.ROOT)
    require(reservedNames.none { reservedName ->
      lowercased == reservedName ||
        lowercased.startsWith("$reservedName.") ||
        lowercased.startsWith("$reservedName ")
    })
  }

  private fun containsForbiddenCodePoint(name: String): Boolean {
    var index = 0
    while (index < name.length) {
      val codePoint = name.codePointAt(index)
      if (
        codePoint in forbiddenCodePoints ||
        codePoint in 0x00..0x1f ||
        codePoint in 0x7f..0x9f ||
        codePoint == 0x061c ||
        codePoint == 0x200e ||
        codePoint == 0x200f ||
        codePoint in 0x202a..0x202e ||
        codePoint in 0x2066..0x2069
      ) {
        return true
      }
      index += Character.charCount(codePoint)
    }
    return false
  }
}

internal fun collisionName(requestedName: String, suffix: Int): String {
  require(suffix >= 0)
  PortableBasenamePolicy.validate(requestedName)

  if (suffix == 0) {
    return requestedName
  }

  val suffixText = " ($suffix)"
  val suffixBytes = suffixText.utf8Size()
  require(suffixBytes <= MAX_FILE_NAME_BYTES)

  val extensionIndex = requestedName.lastIndexOf('.')
  val stem = if (extensionIndex > 0) requestedName.substring(0, extensionIndex) else requestedName
  val extension = if (extensionIndex > 0) requestedName.substring(extensionIndex) else ""
  val fittedExtension = extension
    .truncateUtf8(MAX_FILE_NAME_BYTES - suffixBytes)
    .trimEnd { character -> character == '.' || character == ' ' }
  val fittedStem = stem.truncateUtf8(
    MAX_FILE_NAME_BYTES - suffixBytes - fittedExtension.utf8Size()
  )

  return "$fittedStem$suffixText$fittedExtension"
}

internal fun fileExtension(name: String): String? {
  val extensionIndex = name.lastIndexOf('.')
  return if (extensionIndex > 0 && extensionIndex < name.lastIndex) {
    name.substring(extensionIndex + 1)
  } else {
    null
  }
}

internal fun resolveMimeType(providedMimeType: String?, inferredMimeType: String?): String {
  val mimeType = providedMimeType ?: inferredMimeType ?: DEFAULT_MIME_TYPE
  require(isValidMimeType(mimeType))
  return mimeType
}

internal fun isValidMimeType(mimeType: String): Boolean {
  if (mimeType.length > 255) return false
  val separatorIndex = mimeType.indexOf('/')
  if (separatorIndex <= 0 || separatorIndex != mimeType.lastIndexOf('/')) return false

  val type = mimeType.substring(0, separatorIndex)
  val subtype = mimeType.substring(separatorIndex + 1)
  return mimeTypeComponentPattern.matches(type) && mimeTypeComponentPattern.matches(subtype)
}

internal fun String.utf8Size(): Int {
  var index = 0
  var byteCount = 0

  while (index < length) {
    val character = this[index]
    byteCount += when {
      character.code <= 0x7f -> 1
      character.code <= 0x7ff -> 2
      Character.isHighSurrogate(character) &&
        index + 1 < length &&
        Character.isLowSurrogate(this[index + 1]) -> {
        index += 1
        4
      }
      else -> 3
    }
    index += 1
  }

  return byteCount
}

internal fun String.truncateUtf8(maxBytes: Int): String {
  require(maxBytes >= 0)
  var index = 0
  var byteCount = 0

  while (index < length) {
    val codePoint = codePointAt(index)
    val characterCount = Character.charCount(codePoint)
    val characterBytes = substring(index, index + characterCount).utf8Size()
    if (byteCount + characterBytes > maxBytes) break

    byteCount += characterBytes
    index += characterCount
  }

  return substring(0, index)
}
