import ExpoModulesCore

internal struct SaveFileInput: Record {
  @Field var sourceUri: String = ""
  @Field var name: String = ""
  @Field var size: Int64 = 0
  @Field var mimeType: String? = nil
}

internal struct SavedFile: Record {
  @Field var sourceUri: String = ""
  @Field var name: String = ""
  @Field var locator: String = ""
}

internal struct SaveFileResult: Record {
  @Field var file: SavedFile = SavedFile()
  @Field var downloadsPath: String = ""
}
