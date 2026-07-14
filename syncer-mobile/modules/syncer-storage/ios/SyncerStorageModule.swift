import Dispatch
import ExpoModulesCore
import Foundation
import QuickLook
import UIKit

public final class SyncerStorageModule: Module {
  private let storage = SyncerAppleStorage(
    downloadsDirectory: FileManager.default
      .urls(for: .documentDirectory, in: .userDomainMask)[0]
      .appendingPathComponent("Syncer", isDirectory: true)
  )
  private let storageQueue = DispatchQueue(
    label: "com.syncer.storage.publication",
    qos: .userInitiated
  )
  private var previewCoordinator: PreviewCoordinator?

  public func definition() -> ModuleDefinition {
    Name("SyncerStorage")

    Constant("downloadsPath") {
      storage.downloadsPath
    }

    AsyncFunction("initializeAsync") {
      do {
        try storage.initialize()
      } catch {
        throw storageException(for: error)
      }
    }
    .runOnQueue(storageQueue)

    AsyncFunction("saveFileAsync") { (file: SaveFileInput) -> SaveFileResult in
      do {
        let result = try storage.saveFile(StorageFileInput(file))
        return SaveFileResult(result)
      } catch {
        throw storageException(for: error)
      }
    }
    .runOnQueue(storageQueue)

    AsyncFunction("migrateLegacyFileLocatorAsync") {
      (uri: String?, path: String?, name: String) -> String in
      do {
        return try storage.migrateLegacyFileLocator(uri: uri, path: path, name: name)
      } catch {
        throw storageException(for: error)
      }
    }
    .runOnQueue(storageQueue)

    AsyncFunction("openFileAsync") { [weak self] (locator: String) in
      guard let self else {
        throw Exceptions.AppContextLost()
      }
      guard previewCoordinator == nil else {
        throw PreviewInProgressException()
      }
      guard let viewController = appContext?.utilities?.currentViewController() else {
        throw UnableToOpenFileException(locator)
      }

      let fileURL: URL
      do {
        fileURL = try storage.savedFileURL(for: locator)
      } catch {
        throw storageException(for: error)
      }
      let coordinator = PreviewCoordinator(fileURL: fileURL) { [weak self] in
        self?.previewCoordinator = nil
      }
      let previewController = QLPreviewController()
      previewController.dataSource = coordinator
      previewController.delegate = coordinator
      previewCoordinator = coordinator
      viewController.present(previewController, animated: true)
    }
    .runOnQueue(.main)
  }
}

private extension StorageFileInput {
  init(_ input: SaveFileInput) {
    self.init(
      sourceUri: input.sourceUri,
      name: input.name,
      size: input.size,
      mimeType: input.mimeType
    )
  }
}

private extension SaveFileResult {
  init(_ result: StorageSaveResult) {
    self.init(
      file: SavedFile(result.file),
      downloadsPath: result.downloadsPath
    )
  }
}

private extension SavedFile {
  init(_ file: PublishedFile) {
    self.init(
      sourceUri: file.sourceUri,
      name: file.name,
      locator: file.locator
    )
  }
}

private func storageException(for error: Error) -> Exception {
  guard let storageError = error as? SyncerStorageError else {
    return UnableToSaveFilesException().causedBy(error)
  }

  let exception: Exception
  switch storageError {
  case .invalidFileName(let name):
    exception = InvalidFileNameException(name)
  case .invalidSourceUri(let uri, _):
    exception = InvalidSourceUriException(uri)
  case .invalidMimeType:
    exception = InvalidMimeTypeException()
  case .sourceSizeMismatch(let name, let expected, let actual):
    exception = SourceSizeMismatchException((name, expected, actual))
  case .unableToOpen(let locator, _), .invalidLegacyLocator(let locator):
    exception = UnableToOpenFileException(locator)
  case .notInitialized, .unableToSave(_):
    exception = UnableToSaveFilesException()
  }
  if let underlyingError = storageError.underlyingError {
    return exception.causedBy(underlyingError)
  }
  return exception
}

internal final class PreviewCoordinator: NSObject, QLPreviewControllerDataSource, QLPreviewControllerDelegate {
  private let fileURL: URL
  private let onDismiss: () -> Void

  init(fileURL: URL, onDismiss: @escaping () -> Void) {
    self.fileURL = fileURL
    self.onDismiss = onDismiss
  }

  func numberOfPreviewItems(in controller: QLPreviewController) -> Int {
    SingleItemPreviewIndex.count
  }

  func previewController(
    _ controller: QLPreviewController,
    previewItemAt index: Int
  ) -> QLPreviewItem {
    guard let previewURL = previewURL(at: index) else {
      preconditionFailure("QuickLook requested an out-of-range preview item")
    }
    return previewURL as NSURL
  }

  func previewURL(at index: Int) -> URL? {
    SingleItemPreviewIndex.isValid(index) ? fileURL : nil
  }

  func previewControllerDidDismiss(_ controller: QLPreviewController) {
    onDismiss()
  }
}
