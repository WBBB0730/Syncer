import XCTest

#if SWIFT_PACKAGE
@testable import SyncerStorageCore
#else
@testable import SyncerStorage
#endif

final class SingleItemPreviewIndexTests: XCTestCase {
  func testAcceptsOnlyTheSingleQuickLookItemIndex() {
    XCTAssertEqual(SingleItemPreviewIndex.count, 1)
    XCTAssertTrue(SingleItemPreviewIndex.isValid(0))
    XCTAssertFalse(SingleItemPreviewIndex.isValid(-1))
    XCTAssertFalse(SingleItemPreviewIndex.isValid(1))
  }
}
