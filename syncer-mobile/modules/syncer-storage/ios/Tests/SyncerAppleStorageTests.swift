import Foundation
import XCTest

#if SWIFT_PACKAGE
@testable import SyncerStorageCore
#else
@testable import SyncerStorage
#endif

final class SyncerAppleStorageTests: XCTestCase {
  private var testDirectory: URL!
  private var downloadsDirectory: URL!

  override func setUpWithError() throws {
    testDirectory = FileManager.default.temporaryDirectory
      .appendingPathComponent("SyncerStorageTests-\(UUID().uuidString)", isDirectory: true)
    downloadsDirectory = testDirectory
      .appendingPathComponent("CurrentContainer", isDirectory: true)
      .appendingPathComponent("Documents", isDirectory: true)
      .appendingPathComponent("Syncer", isDirectory: true)
    try FileManager.default.createDirectory(
      at: testDirectory,
      withIntermediateDirectories: true
    )
  }

  override func tearDownWithError() throws {
    if FileManager.default.fileExists(atPath: testDirectory.path) {
      try FileManager.default.removeItem(at: testDirectory)
    }
  }

  func testPublishesExactBytesWithRelativeLocator() throws {
    let bytes = Data((0..<200_000).map { UInt8($0 % 251) })
    let source = try makeSource(name: "source.bin", data: bytes)
    let storage = makeStorage()
    try storage.initialize()

    let result = try storage.saveFile(
      input(source: source, name: "published.bin", size: bytes.count)
    )

    XCTAssertEqual(result.file.sourceUri, source.absoluteString)
    XCTAssertEqual(result.file.locator, "published.bin")
    XCTAssertFalse(result.file.locator.contains("/"))
    XCTAssertEqual(
      try Data(contentsOf: downloadsDirectory.appendingPathComponent(result.file.locator)),
      bytes
    )
  }

  func testPublicationSynchronizesTheDownloadsDirectory() throws {
    let source = try makeSource(name: "source.bin", data: Data([1, 2, 3]))
    let posix = DirectorySyncTrackingPosix()
    let storage = makeStorage(posix: posix)
    try storage.initialize()

    _ = try storage.saveFile(input(source: source, name: "published.bin", size: 3))

    XCTAssertEqual(posix.synchronizationCount, 1)
  }

  func testExclusiveRenameNeverOverwritesExistingDestination() throws {
    let storage = makeStorage()
    try storage.initialize()
    let existing = downloadsDirectory.appendingPathComponent("report.txt")
    try Data("existing".utf8).write(to: existing)
    let source = try makeSource(name: "source.txt", data: Data("new".utf8))

    let result = try storage.saveFile(
      input(source: source, name: "report.txt", size: 3)
    )

    XCTAssertEqual(try Data(contentsOf: existing), Data("existing".utf8))
    XCTAssertEqual(result.file.locator, "report (1).txt")
    XCTAssertEqual(
      try Data(contentsOf: downloadsDirectory.appendingPathComponent("report (1).txt")),
      Data("new".utf8)
    )
  }

  func testPublishAndCleanupFailureRemainsExplicit() throws {
    let source = try makeSource(name: "source.bin", data: Data([1, 2, 3]))
    let posix = FailingPublishAndCleanupPosix()
    let storage = makeStorage(posix: posix)
    try storage.initialize()

    XCTAssertThrowsError(
      try storage.saveFile(input(source: source, name: "published.bin", size: 3))
    ) { error in
      XCTAssertTrue(error is SyncerCompoundError)
    }
    XCTAssertEqual(posix.copyCount, 1)

    XCTAssertThrowsError(
      try storage.saveFile(input(source: source, name: "published.bin", size: 3))
    )
    XCTAssertEqual(posix.copyCount, 1)

    posix.failPublish = false
    posix.failCleanup = false
    let result = try storage.saveFile(
      input(source: source, name: "published.bin", size: 3)
    )

    XCTAssertEqual(result.file.locator, "published.bin")
    XCTAssertEqual(posix.copyCount, 2)
    XCTAssertFalse(
      try FileManager.default.contentsOfDirectory(atPath: downloadsDirectory.path)
        .contains { $0.hasPrefix(".syncer-publication-") }
    )
  }

  func testCopyAndCleanupFailureQuarantinesStagedFileBeforeAnotherCopy() throws {
    let source = try makeSource(name: "source.bin", data: Data([1, 2, 3]))
    let posix = FailingCopyAndCleanupPosix()
    let storage = makeStorage(posix: posix)
    try storage.initialize()

    XCTAssertThrowsError(
      try storage.saveFile(input(source: source, name: "published.bin", size: 3))
    ) { error in
      XCTAssertEqual((error as? SyncerCompoundError)?.errors.count, 2)
    }
    XCTAssertEqual(posix.copyCount, 1)

    XCTAssertThrowsError(
      try storage.saveFile(input(source: source, name: "published.bin", size: 3))
    )
    XCTAssertEqual(posix.copyCount, 1)

    posix.failQuarantineCleanup = false
    let result = try storage.saveFile(
      input(source: source, name: "published.bin", size: 3)
    )

    XCTAssertEqual(result.file.locator, "published.bin")
    XCTAssertEqual(posix.copyCount, 2)
    XCTAssertFalse(
      try FileManager.default.contentsOfDirectory(atPath: downloadsDirectory.path)
        .contains { $0.hasPrefix(".syncer-publication-") }
    )
  }

  func testInitializationCleansOnlyOwnedTemporaryNames() throws {
    try FileManager.default.createDirectory(
      at: downloadsDirectory,
      withIntermediateDirectories: true
    )
    let owned = downloadsDirectory.appendingPathComponent(
      ".syncer-publication-\(UUID().uuidString).partial"
    )
    let unrelated = downloadsDirectory.appendingPathComponent(
      ".syncer-publication-not-a-uuid.partial"
    )
    let normal = downloadsDirectory.appendingPathComponent("keep.txt")
    try Data([1]).write(to: owned)
    try Data([2]).write(to: unrelated)
    try Data([3]).write(to: normal)

    let storage = makeStorage()
    try storage.initialize()

    XCTAssertFalse(FileManager.default.fileExists(atPath: owned.path))
    XCTAssertTrue(FileManager.default.fileExists(atPath: unrelated.path))
    XCTAssertTrue(FileManager.default.fileExists(atPath: normal.path))
  }

  func testLegacyContainerPathsMigrateToCurrentRelativeLocator() throws {
    let storage = makeStorage()
    try storage.initialize()
    let currentFile = downloadsDirectory.appendingPathComponent("report.txt")
    try Data("current".utf8).write(to: currentFile)
    let legacyPath = "/private/var/mobile/Containers/Data/Application/OLD/Documents/Syncer/report.txt"
    let legacyUri = URL(fileURLWithPath: legacyPath).absoluteString

    let locator = try storage.migrateLegacyFileLocator(
      uri: legacyUri,
      path: legacyPath,
      name: "report.txt"
    )

    XCTAssertEqual(locator, "report.txt")
    XCTAssertEqual(try storage.savedFileURL(for: locator), currentFile)
    XCTAssertThrowsError(
      try storage.migrateLegacyFileLocator(
        uri: legacyUri,
        path: legacyPath,
        name: "other.txt"
      )
    )
  }

  func testOpeningRejectsTraversalAndSymlinkEscape() throws {
    let storage = makeStorage()
    try storage.initialize()
    let outside = testDirectory.appendingPathComponent("outside.txt")
    try Data("outside".utf8).write(to: outside)
    let symlink = downloadsDirectory.appendingPathComponent("link.txt")
    try FileManager.default.createSymbolicLink(at: symlink, withDestinationURL: outside)

    XCTAssertThrowsError(try storage.savedFileURL(for: "../outside.txt"))
    XCTAssertThrowsError(try storage.savedFileURL(for: "link.txt"))
  }

  private func makeStorage(
    posix: SyncerPosixOperations = DarwinSyncerPosixOperations()
  ) -> SyncerAppleStorage {
    SyncerAppleStorage(downloadsDirectory: downloadsDirectory, posix: posix)
  }

  private func makeSource(name: String, data: Data) throws -> URL {
    let source = testDirectory.appendingPathComponent(name)
    try data.write(to: source)
    return source
  }

  private func input(source: URL, name: String, size: Int) -> StorageFileInput {
    StorageFileInput(
      sourceUri: source.absoluteString,
      name: name,
      size: Int64(size),
      mimeType: "application/octet-stream"
    )
  }
}

private final class DirectorySyncTrackingPosix: SyncerPosixOperations {
  private let base = DarwinSyncerPosixOperations()
  private(set) var synchronizationCount = 0

  func copyFileExactly(
    from sourceURL: URL,
    sourceUri: String,
    to destinationURL: URL,
    name: String,
    expectedSize: Int64
  ) throws -> ExclusiveFileOperationResult {
    try base.copyFileExactly(
      from: sourceURL,
      sourceUri: sourceUri,
      to: destinationURL,
      name: name,
      expectedSize: expectedSize
    )
  }

  func renameExclusively(from sourceURL: URL, to destinationURL: URL) throws
    -> ExclusiveFileOperationResult {
    try base.renameExclusively(from: sourceURL, to: destinationURL)
  }

  func synchronizeDirectory(at directoryURL: URL) throws {
    synchronizationCount += 1
    try base.synchronizeDirectory(at: directoryURL)
  }

  func removeFileIfExists(at url: URL) throws {
    try base.removeFileIfExists(at: url)
  }
}

private final class FailingPublishAndCleanupPosix: SyncerPosixOperations {
  private let base = DarwinSyncerPosixOperations()
  var failPublish = true
  var failCleanup = true
  private(set) var copyCount = 0

  func copyFileExactly(
    from sourceURL: URL,
    sourceUri: String,
    to destinationURL: URL,
    name: String,
    expectedSize: Int64
  ) throws -> ExclusiveFileOperationResult {
    copyCount += 1
    return try base.copyFileExactly(
      from: sourceURL,
      sourceUri: sourceUri,
      to: destinationURL,
      name: name,
      expectedSize: expectedSize
    )
  }

  func renameExclusively(from sourceURL: URL, to destinationURL: URL) throws
    -> ExclusiveFileOperationResult {
    if failPublish {
      throw SyncerStorageError.unableToSave()
    }
    return try base.renameExclusively(from: sourceURL, to: destinationURL)
  }

  func removeFileIfExists(at url: URL) throws {
    if failCleanup {
      throw SyncerStorageError.unableToSave()
    }
    try base.removeFileIfExists(at: url)
  }

  func synchronizeDirectory(at directoryURL: URL) throws {
    try base.synchronizeDirectory(at: directoryURL)
  }
}

private final class FailingCopyAndCleanupPosix: SyncerPosixOperations {
  private let base = DarwinSyncerPosixOperations()
  var failQuarantineCleanup = true
  private(set) var copyCount = 0

  func copyFileExactly(
    from sourceURL: URL,
    sourceUri: String,
    to destinationURL: URL,
    name: String,
    expectedSize: Int64
  ) throws -> ExclusiveFileOperationResult {
    copyCount += 1
    if copyCount == 1 {
      try Data([1]).write(to: destinationURL)
      throw SyncerCompoundError(
        errors: [SyncerStorageError.unableToSave(), SyncerStorageError.unableToSave()]
      )
    }
    return try base.copyFileExactly(
      from: sourceURL,
      sourceUri: sourceUri,
      to: destinationURL,
      name: name,
      expectedSize: expectedSize
    )
  }

  func renameExclusively(from sourceURL: URL, to destinationURL: URL) throws
    -> ExclusiveFileOperationResult {
    try base.renameExclusively(from: sourceURL, to: destinationURL)
  }

  func removeFileIfExists(at url: URL) throws {
    if failQuarantineCleanup {
      throw SyncerStorageError.unableToSave()
    }
    try base.removeFileIfExists(at: url)
  }

  func synchronizeDirectory(at directoryURL: URL) throws {
    try base.synchronizeDirectory(at: directoryURL)
  }
}
