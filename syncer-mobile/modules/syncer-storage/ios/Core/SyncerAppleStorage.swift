import Foundation

private let directoryPermissions = 0o700
private let temporaryFilePrefix = ".syncer-publication-"
private let temporaryFileSuffix = ".partial"

internal final class SyncerAppleStorage {
  private let downloadsDirectory: URL
  private let fileManager: FileManager
  private let posix: SyncerPosixOperations
  private var quarantinedTemporaryFiles: Set<URL> = []
  private var initialized = false

  init(
    downloadsDirectory: URL,
    fileManager: FileManager = .default,
    posix: SyncerPosixOperations = DarwinSyncerPosixOperations()
  ) {
    self.downloadsDirectory = downloadsDirectory.standardizedFileURL
    self.fileManager = fileManager
    self.posix = posix
  }

  var downloadsPath: String {
    downloadsDirectory.path + "/"
  }

  func initialize() throws {
    initialized = false
    do {
      try fileManager.createDirectory(
        at: downloadsDirectory,
        withIntermediateDirectories: true,
        attributes: [.posixPermissions: directoryPermissions]
      )
      let entries = try fileManager.contentsOfDirectory(
        at: downloadsDirectory,
        includingPropertiesForKeys: nil,
        options: []
      )
      for entry in entries where isOwnedTemporaryFile(entry.lastPathComponent) {
        try posix.removeFileIfExists(at: entry)
      }
      initialized = true
    } catch let error as SyncerStorageError {
      throw error
    } catch {
      throw SyncerStorageError.unableToSave(error)
    }
  }

  func saveFile(_ file: StorageFileInput) throws -> StorageSaveResult {
    guard initialized else {
      throw SyncerStorageError.notInitialized
    }
    try cleanQuarantinedTemporaryFiles()
    try validate(file)
    return StorageSaveResult(
      file: try publishFile(file),
      downloadsPath: downloadsPath
    )
  }

  func savedFileURL(for locator: String) throws -> URL {
    do {
      try SyncerFileNamePolicy.validate(locator)
    } catch {
      throw SyncerStorageError.unableToOpen(locator, error)
    }

    let lexicalFile = downloadsDirectory
      .appendingPathComponent(locator, isDirectory: false)
      .standardizedFileURL
    guard lexicalFile.deletingLastPathComponent() == downloadsDirectory else {
      throw SyncerStorageError.unableToOpen(locator)
    }

    let resolvedDirectory = downloadsDirectory.resolvingSymlinksInPath()
    let resolvedFile = lexicalFile.resolvingSymlinksInPath()
    guard resolvedFile.deletingLastPathComponent() == resolvedDirectory else {
      throw SyncerStorageError.unableToOpen(locator)
    }

    do {
      let values = try resolvedFile.resourceValues(forKeys: [.isRegularFileKey])
      guard values.isRegularFile == true else {
        throw SyncerStorageError.unableToOpen(locator)
      }
      return resolvedFile
    } catch let error as SyncerStorageError {
      throw error
    } catch {
      throw SyncerStorageError.unableToOpen(locator, error)
    }
  }

  func migrateLegacyFileLocator(uri: String?, path: String?, name: String) throws -> String {
    do {
      try SyncerFileNamePolicy.validate(name)
    } catch {
      throw SyncerStorageError.invalidLegacyLocator(name)
    }

    var migratedLocators: [String] = []
    if let uri {
      guard let url = URL(string: uri), url.isFileURL else {
        throw SyncerStorageError.invalidLegacyLocator(uri)
      }
      migratedLocators.append(try legacyLocator(fromAbsolutePath: url.path))
    }
    if let path {
      guard (path as NSString).isAbsolutePath else {
        throw SyncerStorageError.invalidLegacyLocator(path)
      }
      migratedLocators.append(try legacyLocator(fromAbsolutePath: path))
    }

    if migratedLocators.isEmpty {
      return name
    }
    guard migratedLocators.allSatisfy({ $0 == name }) else {
      throw SyncerStorageError.invalidLegacyLocator(migratedLocators.joined(separator: ", "))
    }
    return name
  }

  private func legacyLocator(fromAbsolutePath path: String) throws -> String {
    guard (path as NSString).isAbsolutePath else {
      throw SyncerStorageError.invalidLegacyLocator(path)
    }
    let url = URL(fileURLWithPath: path).standardizedFileURL
    let fileName = url.lastPathComponent
    let syncerDirectory = url.deletingLastPathComponent()
    let documentsDirectory = syncerDirectory.deletingLastPathComponent()
    guard
      !fileName.isEmpty,
      syncerDirectory.lastPathComponent == "Syncer",
      documentsDirectory.lastPathComponent == "Documents"
    else {
      throw SyncerStorageError.invalidLegacyLocator(path)
    }
    do {
      try SyncerFileNamePolicy.validate(fileName)
      return fileName
    } catch {
      throw SyncerStorageError.invalidLegacyLocator(path)
    }
  }

  private func validate(_ file: StorageFileInput) throws {
    try SyncerFileNamePolicy.validate(file.name)
    guard !file.sourceUri.isEmpty else {
      throw SyncerStorageError.invalidSourceUri(file.sourceUri)
    }
    guard file.size >= 0 else {
      throw SyncerStorageError.sourceSizeMismatch(name: file.name, expected: file.size, actual: 0)
    }
    try SyncerMimeTypePolicy.validate(file.mimeType)
  }

  private func publishFile(_ file: StorageFileInput) throws -> PublishedFile {
    guard let sourceURL = URL(string: file.sourceUri), sourceURL.isFileURL else {
      throw SyncerStorageError.invalidSourceUri(file.sourceUri)
    }

    let stagedFile = try stageFile(
      sourceURL: sourceURL.standardizedFileURL,
      input: file
    )
    do {
      let destinationURL = try publish(
        stagedFile: stagedFile,
        requestedName: file.name
      )
      return PublishedFile(
        sourceUri: file.sourceUri,
        name: destinationURL.lastPathComponent,
        locator: destinationURL.lastPathComponent
      )
    } catch {
      do {
        try posix.removeFileIfExists(at: stagedFile)
      } catch let cleanupError {
        quarantinedTemporaryFiles.insert(stagedFile)
        throw SyncerCompoundError(errors: [error, cleanupError])
      }
      throw error
    }
  }

  private func cleanQuarantinedTemporaryFiles() throws {
    for file in Array(quarantinedTemporaryFiles) {
      try posix.removeFileIfExists(at: file)
      quarantinedTemporaryFiles.remove(file)
    }
  }

  private func stageFile(sourceURL: URL, input: StorageFileInput) throws -> URL {
    while true {
      let stagedFile = downloadsDirectory.appendingPathComponent(
        temporaryFileName(uuid: UUID()),
        isDirectory: false
      )
      let result: ExclusiveFileOperationResult
      do {
        result = try posix.copyFileExactly(
          from: sourceURL,
          sourceUri: input.sourceUri,
          to: stagedFile,
          name: input.name,
          expectedSize: input.size
        )
      } catch {
        quarantinedTemporaryFiles.insert(stagedFile)
        throw error
      }
      switch result {
      case .success:
        return stagedFile
      case .destinationExists:
        continue
      }
    }
  }

  private func publish(stagedFile: URL, requestedName: String) throws -> URL {
    var collisionIndex = 0
    while true {
      let name = SyncerFileNamePolicy.candidate(
        for: requestedName,
        collisionIndex: collisionIndex
      )
      let destinationURL = downloadsDirectory.appendingPathComponent(name, isDirectory: false)
      let result = try posix.renameExclusively(from: stagedFile, to: destinationURL)
      switch result {
      case .success:
        do {
          try posix.synchronizeDirectory(at: downloadsDirectory)
          return destinationURL
        } catch {
          do {
            try posix.removeFileIfExists(at: destinationURL)
            try posix.synchronizeDirectory(at: downloadsDirectory)
          } catch let cleanupError {
            quarantinedTemporaryFiles.insert(destinationURL)
            throw SyncerCompoundError(errors: [error, cleanupError])
          }
          throw error
        }
      case .destinationExists:
        guard collisionIndex < Int.max else {
          throw SyncerStorageError.unableToSave()
        }
        collisionIndex += 1
      }
    }
  }

  private func temporaryFileName(uuid: UUID) -> String {
    temporaryFilePrefix + uuid.uuidString + temporaryFileSuffix
  }

  private func isOwnedTemporaryFile(_ name: String) -> Bool {
    guard
      name.hasPrefix(temporaryFilePrefix),
      name.hasSuffix(temporaryFileSuffix)
    else {
      return false
    }
    let start = name.index(name.startIndex, offsetBy: temporaryFilePrefix.count)
    let end = name.index(name.endIndex, offsetBy: -temporaryFileSuffix.count)
    return UUID(uuidString: String(name[start..<end])) != nil
  }
}
