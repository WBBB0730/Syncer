# 0006. Cross-platform streaming File Transfer and disk staging

- Status: accepted
- Related: ADR-0004, ADR-0005, ADR-0007

## Context

The vNext wire format carries binary chunks, but a client can still defeat that benefit by reading a complete file as Base64, copying it through UI state or IPC, collecting every received chunk in memory, and only then writing the result. Large or multi-file transfers therefore create several full-size copies, have no bounded backpressure, and can leave ambiguous partial results after disconnects.

File Transfer must remain part of the long-lived Session and keep the existing send and one-action save experience. The resource model must work across Node/Electron paths and mobile content URIs without requiring a side HTTP service.

## Decision

- The sender reads each selected file incrementally from a platform file handle, path, or content URI and writes bounded binary frames to the existing Session. A complete file is never represented as Base64 or one in-memory byte array.
- Files in one `file-offer` are sent sequentially. The sender respects socket backpressure where the platform exposes it; otherwise its adapter must keep a bounded write queue rather than enqueueing the whole file.
- The receiver creates one application-owned temporary file for the active `file-begin` and appends binary frames directly to disk. It tracks the offered ID, safe display name, declared size, and received byte count.
- Binary data without an active file, nested or duplicate begins, unknown IDs, overflow beyond the declared size, and `file-end` before an exact size match fail the transfer. Partial files are never exposed as completed Receive History entries.
- A `file-offer` is one receive batch. The receiver keeps completed temporary-file descriptors until every offered file has completed, then presents the existing single save/ignore decision for that batch; later files must not replace earlier results.
- Every receive batch reserves both one batch slot and its declared aggregate bytes from a process-wide staging budget before disk ownership is accepted. The reservation remains charged while receiving, awaiting a decision, publishing, retrying a partial publication, or awaiting successful cleanup; limits therefore apply across concurrent and disconnected batches, not only to the active Session.
- Ignoring a completed batch, interrupting an active batch, timing out, failing validation, or restarting the app removes the related temporary files. A fully received batch awaiting the existing save/ignore decision remains available if the Session closes. Cleanup first revokes application ownership, then removes disk state; a failed removal cannot silently release the corresponding staging budget.
- Desktop staging uses one deterministic application-owned root. The elected single app instance resets that root before opening the network stack, so crash leftovers are removed without deleting another live instance's files.
- Platform publication reports the exact staged source URI for every durable destination. A complete publication removes the batch. A partial publication records history only for durable destinations, removes only those published staging files, and presents the remaining files for retry without receiving them again.
- Desktop publication copies into a uniquely owned temporary file in the selected destination directory and flushes the file before commit. The Windows client commits that same-directory file with `MoveFileW`, whose destination must not already exist; collision failure selects the next local name without overwriting. The mature Koffi package supplies only the native FFI boundary. Windows is the only desktop platform in scope and there is no non-atomic fallback, so a final filename never refers to a half-copied file.
- Desktop records each owned destination temporary file in an atomically replaced publication journal under Electron `userData`, separate from the volatile staging root, before creating the file. `write-file-atomic` owns the journal's flushed temporary write, atomic replacement, and failed-temporary cleanup. Startup and later publication operations clean only those exact journaled temporaries. The journal guarantees process-crash cleanup but makes no stronger power-loss ordering claim.
- Desktop save and ignore actions are owned asynchronous receipt operations. Shutdown closes their attached UI, awaits those operations and all background transfer cleanup, then releases staging ownership. Renderer reload queries the main process for pending receipts and de-duplicates them against live receipt events.
- Remote names are display metadata only. Each platform enforces one portable basename policy (including Windows device names and their superscript-digit variants), resolves collisions locally, and verifies that temporary and desktop destination paths remain inside their intended directories.
- Per-file, file-count, per-batch, frame, and handshake limits are finite, centrally configured in `@syncer/protocol`, and checked before and during transfer. They are versioned protocol safeguards rather than platform-specific exceptions.
- Shared protocol code owns transfer metadata validation and the pure receive lifecycle. Desktop and mobile adapters own file access, socket writes, temporary storage, publication, and user notifications.

## Consequences

- File Transfer memory use is bounded by frame and adapter buffers instead of total file size.
- Desktop privileged file I/O remains outside the renderer; mobile code can retain content URIs instead of translating them to Base64.
- Receive History is written only after durable publication, not when the final network frame arrives.
- Desktop adapter tests cover restart cleanup with a separate atomic journal, crash boundaries before and after atomic commit, exact published bytes, collision-safe publication, staging path boundaries, atomic JSON replacement, and invalid/corrupt storage rejection.
- Protocol and integration tests must assert final receiver bytes, size mismatch rejection, multi-file batching, backpressure, cross-batch staging limits, disconnect cleanup, partial publication ownership, unsafe names, and collision handling.
- Checksums, parallel files, pause/resume, and recovery across a new Session require a later protocol decision and are not implied by this ADR.

## Alternatives considered

- Whole-file Base64 or byte arrays — rejected because memory grows with file size and copies multiply across process boundaries.
- A separate HTTP upload endpoint — rejected because File Transfer is part of the existing Session model.
- Placeholder-and-rename and hard-link publication — rejected because they either expose a user-visible incomplete final name or depend on filesystem link support. Direct copy to the final name is rejected because it exposes partial content and cannot provide atomic no-overwrite commit.
- Parallel files and resumable chunks in this generation — deferred to keep ordering and recovery semantics small enough to verify.

## References

- [Microsoft MoveFileW](https://learn.microsoft.com/en-us/windows/win32/api/winbase/nf-winbase-movefilew)
- [Koffi documentation](https://koffi.dev/)
- [write-file-atomic](https://www.npmjs.com/package/write-file-atomic)
