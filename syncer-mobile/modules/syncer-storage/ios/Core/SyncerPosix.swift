import Darwin
import Foundation

internal enum ExclusiveFileOperationResult {
  case success
  case destinationExists
}

internal protocol SyncerPosixOperations {
  func copyFileExactly(
    from sourceURL: URL,
    sourceUri: String,
    to destinationURL: URL,
    name: String,
    expectedSize: Int64
  ) throws -> ExclusiveFileOperationResult

  func renameExclusively(from sourceURL: URL, to destinationURL: URL) throws
    -> ExclusiveFileOperationResult

  func synchronizeDirectory(at directoryURL: URL) throws

  func removeFileIfExists(at url: URL) throws
}

internal struct DarwinSyncerPosixOperations: SyncerPosixOperations {
  private let copyBufferSize = 64 * 1024
  private let filePermissions = mode_t(S_IRUSR | S_IWUSR)

  func copyFileExactly(
    from sourceURL: URL,
    sourceUri: String,
    to destinationURL: URL,
    name: String,
    expectedSize: Int64
  ) throws -> ExclusiveFileOperationResult {
    var sourceDescriptor = Darwin.open(sourceURL.path, O_RDONLY)
    guard sourceDescriptor >= 0 else {
      throw SyncerStorageError.invalidSourceUri(sourceUri, posixError(errno))
    }

    var destinationDescriptor: Int32 = -1
    var destinationWasCreated = false

    do {
      try validateSource(
        descriptor: sourceDescriptor,
        sourceUri: sourceUri,
        name: name,
        expectedSize: expectedSize
      )

      destinationDescriptor = Darwin.open(
        destinationURL.path,
        O_CREAT | O_EXCL | O_WRONLY,
        filePermissions
      )
      if destinationDescriptor < 0 {
        let errorCode = errno
        try closeDescriptor(&sourceDescriptor)
        if errorCode == EEXIST {
          return .destinationExists
        }
        throw SyncerStorageError.unableToSave(posixError(errorCode))
      }
      destinationWasCreated = true

      try copyBytes(
        sourceDescriptor: sourceDescriptor,
        sourceUri: sourceUri,
        destinationDescriptor: destinationDescriptor,
        name: name,
        expectedSize: expectedSize
      )
      if Darwin.fsync(destinationDescriptor) != 0 {
        throw SyncerStorageError.unableToSave(posixError(errno))
      }

      try closeDescriptor(&destinationDescriptor)
      try closeDescriptor(&sourceDescriptor)
      return .success
    } catch {
      var errors = [error]
      appendCloseError(&destinationDescriptor, to: &errors)
      appendCloseError(&sourceDescriptor, to: &errors)
      if destinationWasCreated {
        do {
          try removeFileIfExists(at: destinationURL)
        } catch {
          errors.append(error)
        }
      }
      if errors.count == 1 {
        throw errors[0]
      }
      throw SyncerCompoundError(errors: errors)
    }
  }

  func renameExclusively(from sourceURL: URL, to destinationURL: URL) throws
    -> ExclusiveFileOperationResult {
    let result = sourceURL.path.withCString { sourcePath in
      destinationURL.path.withCString { destinationPath in
        Darwin.renamex_np(sourcePath, destinationPath, UInt32(RENAME_EXCL))
      }
    }
    if result == 0 {
      return .success
    }

    let errorCode = errno
    if errorCode == EEXIST {
      return .destinationExists
    }
    throw SyncerStorageError.unableToSave(posixError(errorCode))
  }

  func synchronizeDirectory(at directoryURL: URL) throws {
    var descriptor = Darwin.open(directoryURL.path, O_RDONLY)
    guard descriptor >= 0 else {
      throw SyncerStorageError.unableToSave(posixError(errno))
    }

    do {
      if Darwin.fsync(descriptor) != 0 {
        throw SyncerStorageError.unableToSave(posixError(errno))
      }
      try closeDescriptor(&descriptor)
    } catch {
      var errors = [error]
      appendCloseError(&descriptor, to: &errors)
      if errors.count == 1 {
        throw errors[0]
      }
      throw SyncerCompoundError(errors: errors)
    }
  }

  func removeFileIfExists(at url: URL) throws {
    if Darwin.unlink(url.path) == 0 {
      return
    }
    let errorCode = errno
    if errorCode != ENOENT {
      throw SyncerStorageError.unableToSave(posixError(errorCode))
    }
  }

  private func validateSource(
    descriptor: Int32,
    sourceUri: String,
    name: String,
    expectedSize: Int64
  ) throws {
    var status = stat()
    guard Darwin.fstat(descriptor, &status) == 0 else {
      throw SyncerStorageError.invalidSourceUri(sourceUri, posixError(errno))
    }
    guard status.st_mode & S_IFMT == S_IFREG else {
      throw SyncerStorageError.invalidSourceUri(sourceUri)
    }
    guard status.st_size == expectedSize else {
      throw SyncerStorageError.sourceSizeMismatch(
        name: name,
        expected: expectedSize,
        actual: status.st_size
      )
    }
  }

  private func copyBytes(
    sourceDescriptor: Int32,
    sourceUri: String,
    destinationDescriptor: Int32,
    name: String,
    expectedSize: Int64
  ) throws {
    var buffer = [UInt8](repeating: 0, count: copyBufferSize)
    var copiedBytes: Int64 = 0

    while true {
      let readCount = try readRetryingInterrupts(
        descriptor: sourceDescriptor,
        sourceUri: sourceUri,
        buffer: &buffer
      )
      if readCount == 0 {
        break
      }

      let (nextByteCount, overflow) = copiedBytes.addingReportingOverflow(Int64(readCount))
      guard !overflow, nextByteCount <= expectedSize else {
        throw SyncerStorageError.sourceSizeMismatch(
          name: name,
          expected: expectedSize,
          actual: nextByteCount
        )
      }

      var writeOffset = 0
      while writeOffset < readCount {
        let writeCount = buffer.withUnsafeBytes { bytes in
          Darwin.write(
            destinationDescriptor,
            bytes.baseAddress?.advanced(by: writeOffset),
            readCount - writeOffset
          )
        }
        if writeCount < 0 {
          let errorCode = errno
          if errorCode == EINTR {
            continue
          }
          throw SyncerStorageError.unableToSave(posixError(errorCode))
        }
        guard writeCount > 0 else {
          throw SyncerStorageError.unableToSave(posixError(EIO))
        }
        writeOffset += writeCount
      }

      copiedBytes = nextByteCount
    }

    guard copiedBytes == expectedSize else {
      throw SyncerStorageError.sourceSizeMismatch(
        name: name,
        expected: expectedSize,
        actual: copiedBytes
      )
    }
  }

  private func readRetryingInterrupts(
    descriptor: Int32,
    sourceUri: String,
    buffer: inout [UInt8]
  ) throws -> Int {
    while true {
      let readCount = buffer.withUnsafeMutableBytes { bytes in
        Darwin.read(descriptor, bytes.baseAddress, bytes.count)
      }
      if readCount >= 0 {
        return readCount
      }
      let errorCode = errno
      if errorCode != EINTR {
        throw SyncerStorageError.invalidSourceUri(sourceUri, posixError(errorCode))
      }
    }
  }

  private func closeDescriptor(_ descriptor: inout Int32) throws {
    guard descriptor >= 0 else {
      return
    }
    let openDescriptor = descriptor
    descriptor = -1
    if Darwin.close(openDescriptor) != 0 {
      throw SyncerStorageError.unableToSave(posixError(errno))
    }
  }

  private func appendCloseError(_ descriptor: inout Int32, to errors: inout [Error]) {
    do {
      try closeDescriptor(&descriptor)
    } catch {
      errors.append(error)
    }
  }

  private func posixError(_ code: Int32) -> NSError {
    NSError(domain: NSPOSIXErrorDomain, code: Int(code))
  }
}
