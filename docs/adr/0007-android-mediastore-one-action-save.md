# 0007. Android MediaStore publication with one-action save

- Status: accepted
- Related: ADR-0002, ADR-0006

## Context

Modern Android scoped storage does not provide reliable direct filesystem writes to an arbitrary public `Download/Syncer` path. Keeping received files only in app-private storage makes them hard to find, while requiring the Storage Access Framework directory picker for every batch would replace Syncer’s existing one-action save flow. Syncer's supported Android floor is Android 10 / API 29, so a legacy public-filesystem branch is unnecessary.

Android’s official storage guidance recommends inserting app-created shared files into a MediaStore collection; apps can contribute their own entries without storage permission starting with Android 10 (`Build.VERSION_CODES.Q`).

## Decision

- ADR-0006 application-owned temporary files remain the source for publication. Pressing the existing save action publishes the complete receive batch without adding a directory-selection step.
- On every supported Android version, publish each file through `MediaStore.Downloads` on the primary external volume. Insert `DISPLAY_NAME`, an inferred or fallback `MIME_TYPE`, `RELATIVE_PATH = Download/Syncer`, and `IS_PENDING = 1`.
- Publish the batch sequentially. For each file, stream the staged bytes through the `ContentResolver` output stream for the returned content URI, verify the exact byte count, close the stream, then update `IS_PENDING = 0` before advancing. On a later failure, keep already finalized files, delete only pending rows and temporary publication state, and return the exact finalized `sourceUri` set as partial success.
- Resolve unsafe names and collisions before insertion using the same basename policy as ADR-0006. The returned content URI, not an assumed filesystem path, is the authoritative identity of the saved file.
- New Receive History entries store display name, content URI, and save time. Existing path-based history remains readable; migration is additive and does not delete old records.
- Opening a new history entry uses its content URI through Android platform APIs. Deleting a Receive History entry keeps the existing behavior and removes only the record, not the published file.
- On initialization, remove only pending rows owned by Syncer's package in `Download/Syncer`; never treat another application's rows as cleanup targets.
- Do not request `WRITE_EXTERNAL_STORAGE`, `READ_EXTERNAL_STORAGE`, `MANAGE_EXTERNAL_STORAGE`, or `READ_MEDIA_*`, and do not use raw public paths to publish Syncer-created files.

## Consequences

- The visible interaction remains one save action and successful files remain user-visible under Downloads/Syncer.
- Android publication becomes a platform adapter; Session framing and cross-platform staging remain governed by ADR-0006.
- A failed multi-file publication keeps already finalized files visible. The UI reports partial success precisely, history records only finalized entries, and all owned pending rows and unpublished staging files are cleaned up.
- Tests must cover MediaStore publication, arbitrary MIME types, duplicate names, exact byte validation, partial batch failure, history reopening, owned pending-row cleanup, and ambiguous rollback state.

## Alternatives considered

- Direct writes to `RNFS.DownloadDirectoryPath` on every Android version — rejected because scoped storage blocks or makes that path unreliable on current target SDKs.
- An Android 9 public-filesystem fallback — rejected because Android 9 is outside the support contract and the extra branch would weaken one publication model without serving supported devices.
- Storage Access Framework directory selection for each save — rejected because it changes the established one-action flow.
- App-private storage only — rejected because saved files would not behave like user downloads.
- Broad all-files access — rejected because Syncer does not need unrestricted shared-storage access.

## References

- [Android shared storage guidance](https://developer.android.com/training/data-storage/shared/media)
- [MediaStore API reference](https://developer.android.com/reference/android/provider/MediaStore)
