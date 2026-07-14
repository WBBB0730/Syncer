import { MAX_FILE_NAME_BYTES } from './constants.js'

const encoder = new TextEncoder()
const windowsReservedFileNamePattern =
  /^(?:con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])(?:[. ]|$)/iu

export function utf8ByteLength(value: string): number {
  return encoder.encode(value).byteLength
}

export function isWindowsReservedFileName(value: string): boolean {
  return windowsReservedFileNamePattern.test(value)
}

export function truncateUtf8(value: string, maxBytes: number): string {
  if (maxBytes < 0) throw new Error('UTF-8 byte limit must not be negative')
  let result = ''
  let bytes = 0
  for (const character of value) {
    const characterBytes = utf8ByteLength(character)
    if (bytes + characterBytes > maxBytes) break
    result += character
    bytes += characterBytes
  }
  return result
}

export function collisionFileName(
  original: string,
  collisionIndex: number,
  maxBytes = MAX_FILE_NAME_BYTES
): string {
  if (!Number.isSafeInteger(collisionIndex) || collisionIndex < 1) {
    throw new Error('File name collision index must be a positive safe integer')
  }

  const suffix = ` (${collisionIndex})`
  const suffixBytes = utf8ByteLength(suffix)
  if (suffixBytes > maxBytes) throw new Error('File name collision suffix exceeds the byte limit')

  const extensionIndex = original.lastIndexOf('.')
  const stem = extensionIndex > 0 ? original.slice(0, extensionIndex) : original
  const extension = extensionIndex > 0 ? original.slice(extensionIndex) : ''
  const fittedExtension = truncateUtf8(extension, maxBytes - suffixBytes).replace(/[. ]+$/, '')
  const fittedStem = truncateUtf8(
    stem,
    maxBytes - suffixBytes - utf8ByteLength(fittedExtension)
  )
  return `${fittedStem}${suffix}${fittedExtension}`
}
