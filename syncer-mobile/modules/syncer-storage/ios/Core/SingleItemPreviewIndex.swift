internal enum SingleItemPreviewIndex {
  static let count = 1

  static func isValid(_ index: Int) -> Bool {
    index == 0
  }
}
