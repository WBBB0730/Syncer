package expo.modules.syncerstorage

import expo.modules.kotlin.records.Field
import expo.modules.kotlin.records.Record
import expo.modules.kotlin.types.OptimizedRecord

@OptimizedRecord
internal data class SaveFileInput(
  @Field
  val sourceUri: String,

  @Field
  val name: String,

  @Field
  val size: Long,

  @Field
  val mimeType: String? = null
) : Record

@OptimizedRecord
internal data class SavedFile(
  @Field
  val sourceUri: String,

  @Field
  val name: String,

  @Field
  val locator: String
) : Record

@OptimizedRecord
internal data class SaveFileResult(
  @Field
  val file: SavedFile,

  @Field
  val downloadsPath: String
) : Record
