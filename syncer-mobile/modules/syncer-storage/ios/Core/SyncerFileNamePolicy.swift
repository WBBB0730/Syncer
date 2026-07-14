import Foundation

internal enum SyncerFileNamePolicy {
  static let maximumByteCount = 255

  private static let forbiddenScalars = Set("<>:\"/\\|?*".unicodeScalars.map(\.value))
  private static let reservedNames: Set<String> = [
    "con", "prn", "aux", "nul",
    "com1", "com2", "com3", "com4", "com5", "com6", "com7", "com8", "com9",
    "com¹", "com²", "com³",
    "lpt1", "lpt2", "lpt3", "lpt4", "lpt5", "lpt6", "lpt7", "lpt8", "lpt9",
    "lpt¹", "lpt²", "lpt³",
  ]

  static func validate(_ name: String) throws {
    guard
      !name.isEmpty,
      name != ".",
      name != "..",
      name.utf8.count <= maximumByteCount,
      !name.hasSuffix("."),
      !name.hasSuffix(" "),
      !containsForbiddenScalar(name),
      !isReserved(name)
    else {
      throw SyncerStorageError.invalidFileName(name)
    }
  }

  static func candidate(for requestedName: String, collisionIndex: Int) -> String {
    precondition(collisionIndex >= 0)
    precondition((try? validate(requestedName)) != nil)

    if collisionIndex == 0 {
      return requestedName
    }

    let suffix = " (\(collisionIndex))"
    precondition(suffix.utf8.count <= maximumByteCount)

    let (stem, fileExtension) = splitExtension(in: requestedName)
    let fittedExtension = trimPortableSuffix(
      from: utf8Prefix(
        of: fileExtension,
        maximumByteCount: maximumByteCount - suffix.utf8.count
      )
    )
    let fittedStem = utf8Prefix(
      of: stem,
      maximumByteCount: maximumByteCount - suffix.utf8.count - fittedExtension.utf8.count
    )
    return fittedStem + suffix + fittedExtension
  }

  private static func containsForbiddenScalar(_ name: String) -> Bool {
    name.unicodeScalars.contains { scalar in
      let value = scalar.value
      return forbiddenScalars.contains(value) ||
        value <= 0x1f ||
        (0x7f...0x9f).contains(value) ||
        value == 0x061c ||
        value == 0x200e ||
        value == 0x200f ||
        (0x202a...0x202e).contains(value) ||
        (0x2066...0x2069).contains(value)
    }
  }

  private static func isReserved(_ name: String) -> Bool {
    let lowercased = name.lowercased(with: Locale(identifier: "en_US_POSIX"))
    return reservedNames.contains { reserved in
      lowercased == reserved ||
        lowercased.hasPrefix(reserved + ".") ||
        lowercased.hasPrefix(reserved + " ")
    }
  }

  private static func splitExtension(in name: String) -> (stem: String, fileExtension: String) {
    guard
      let extensionStart = name.lastIndex(of: "."),
      extensionStart != name.startIndex
    else {
      return (name, "")
    }

    return (
      String(name[..<extensionStart]),
      String(name[extensionStart...])
    )
  }

  private static func utf8Prefix(of value: String, maximumByteCount: Int) -> String {
    precondition(maximumByteCount >= 0)
    var result = ""
    var byteCount = 0

    for scalar in value.unicodeScalars {
      let scalarByteCount = String(scalar).utf8.count
      guard byteCount + scalarByteCount <= maximumByteCount else {
        break
      }
      result.unicodeScalars.append(scalar)
      byteCount += scalarByteCount
    }

    return result
  }

  private static func trimPortableSuffix(from value: String) -> String {
    var result = value
    while result.hasSuffix(".") || result.hasSuffix(" ") {
      result.removeLast()
    }
    return result
  }
}
