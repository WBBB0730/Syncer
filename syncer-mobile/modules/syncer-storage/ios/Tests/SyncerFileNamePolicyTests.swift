import XCTest

#if SWIFT_PACKAGE
@testable import SyncerStorageCore
#else
@testable import SyncerStorage
#endif

final class SyncerFileNamePolicyTests: XCTestCase {
  func testMatchesSharedPortableBasenameVectors() throws {
    let invalidNames = [
      "", ".", "..", "../secret.txt", "folder/file.txt", "folder\\file.txt",
      "CON", "CON .txt", "lpt1.log", "trailing.", "trailing ",
      "COM¹.txt", "com²", "CoM³.log",
      "LPT¹.txt", "lpt²", "LpT³.log",
      "bad\u{0000}name", "bad\u{0085}name", "invoice\u{202e}fdp.exe", "bad:name",
    ]
    for name in invalidNames {
      XCTAssertThrowsError(try SyncerFileNamePolicy.validate(name), name)
    }

    let validNames = [
      ".env",
      "\u{62a5}\u{544a} 1.txt",
      "conduit.txt",
      "lpt10.txt",
      "\u{5bb6}\u{5ead}\u{200d}\u{6210}\u{5458}.txt",
    ]
    for name in validNames {
      XCTAssertNoThrow(try SyncerFileNamePolicy.validate(name), name)
    }

    XCTAssertNoThrow(try SyncerFileNamePolicy.validate(String(repeating: "\u{6587}", count: 85)))
    XCTAssertThrowsError(
      try SyncerFileNamePolicy.validate(String(repeating: "\u{6587}", count: 86))
    )
  }

  func testCollisionNamesMatchSharedVectors() throws {
    let ascii = SyncerFileNamePolicy.candidate(
      for: String(repeating: "a", count: 251) + ".txt",
      collisionIndex: 1
    )
    XCTAssertEqual(ascii.utf8.count, 255)
    XCTAssertTrue(ascii.hasSuffix(" (1).txt"))

    let unicode = SyncerFileNamePolicy.candidate(
      for: String(repeating: "\u{6587}", count: 83) + ".txt",
      collisionIndex: 12
    )
    XCTAssertLessThanOrEqual(unicode.utf8.count, 255)
    XCTAssertTrue(unicode.hasSuffix(" (12).txt"))
    XCTAssertEqual(
      SyncerFileNamePolicy.candidate(for: ".env", collisionIndex: 1),
      ".env (1)"
    )

    let spacedExtension = SyncerFileNamePolicy.candidate(
      for: "xx." + String(repeating: "a", count: 249) + " bc",
      collisionIndex: 1
    )
    XCTAssertFalse(spacedExtension.hasSuffix("."))
    XCTAssertFalse(spacedExtension.hasSuffix(" "))
    XCTAssertNoThrow(try SyncerFileNamePolicy.validate(spacedExtension))
  }

  func testMimeTypesMatchSharedTokenAndLengthRules() throws {
    let validMimeTypes: [String?] = [
      nil,
      "application/vnd.syncer+json",
      "application/vnd.syncer~json",
      "!#$%&'*+.^_`|~-token/type",
      "*/*",
      "a/" + String(repeating: "b", count: 253),
    ]
    for mimeType in validMimeTypes {
      XCTAssertNoThrow(try SyncerMimeTypePolicy.validate(mimeType))
    }

    let invalidMimeTypes = [
      "", "text", "text/plain; charset=utf-8", "text / plain",
      "a/" + String(repeating: "b", count: 254),
    ]
    for mimeType in invalidMimeTypes {
      XCTAssertThrowsError(try SyncerMimeTypePolicy.validate(mimeType))
    }
  }
}
