internal enum SyncerMimeTypePolicy {
  private static let tokenPunctuation = Set("!#$%&'*+.^_`|~-".unicodeScalars.map(\.value))

  static func validate(_ mimeType: String?) throws {
    guard let mimeType else {
      return
    }
    let components = mimeType.split(separator: "/", omittingEmptySubsequences: false)
    guard
      mimeType.utf8.count <= 255,
      components.count == 2,
      components.allSatisfy({ !$0.isEmpty && $0.unicodeScalars.allSatisfy(isTokenScalar) })
    else {
      throw SyncerStorageError.invalidMimeType
    }
  }

  private static func isTokenScalar(_ scalar: Unicode.Scalar) -> Bool {
    let value = scalar.value
    return (0x30...0x39).contains(value) ||
      (0x41...0x5a).contains(value) ||
      (0x61...0x7a).contains(value) ||
      tokenPunctuation.contains(value)
  }
}
