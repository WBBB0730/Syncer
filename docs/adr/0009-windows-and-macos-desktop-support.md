# 0009. Windows and macOS desktop support

- Status: accepted
- Related: ADR-0001, ADR-0005, ADR-0006

## Context

The rebuilt desktop client initially kept Windows-only native boundaries for Command execution and atomic File Transfer publication. Loading those boundaries lazily allowed development on macOS, but it did not make the packaged application functional there: Command was rejected, received files could not be committed, and the application did not follow macOS permission, menu, Dock, tray, or packaging conventions.

## Decision

- Support Windows 10+ on x64 and macOS 14+ on x64 and arm64 with the Electron 43 desktop client. The selected macOS keyboard binary has a macOS 14 deployment target. macOS produces separate architecture-specific DMG files rather than merging native modules into one universal package.
- Replace the Windows-only keyboard binding with the public `@nut-tree-fork/nut-js` package and load it normally. Every wire-level Command has an explicit `Key` mapping; protocol strings are never passed directly to the native module.
- Expose only the common media controls in the mobile Command UI: previous, play/pause, next, mute, volume down, and volume up. A stop control is not exposed because the macOS backend does not support it consistently.
- Before executing a Command on macOS, request and verify Accessibility permission. A denial or native injection failure is reported to the desktop renderer without ending the Session.
- Preserve atomic no-overwrite desktop publication on both systems. Windows commits with `MoveFileW`; macOS commits with `renamex_np(..., RENAME_EXCL)`. Koffi provides the native FFI boundary, and there is no overwrite-prone fallback.
- Give the macOS bundle a stable reverse-DNS identifier and local-network usage description. Keep the standard macOS application menu, restore the primary window from the Dock, and present the tray image as a template image.
- Local builds and CI apply an ad-hoc signature to each app bundle after Electron Fuses, with Hardened Runtime disabled so the validation package does not require `disable-library-validation`. CI verifies the complete bundle signature for x64 and arm64 packages. Public macOS distribution must instead use Developer ID, Hardened Runtime and notarization credentials; automatic GitHub release remains out of scope until that separate signing configuration is added.
- Adding the new media Command values is a breaking wire change, so both clients move to Protocol Version 3.

## Consequences

- Windows and macOS share one Command implementation while retaining explicit platform permission handling.
- macOS users must grant Accessibility before the first successful Command and local-network access before Discovery and Session traffic can work.
- Received-file collision and durability behavior remains identical across supported desktop platforms.
- CI artifacts prove packaging, bundle integrity, and native-module architecture composition, but they are not substitutes for Developer ID signed and notarized public downloads.
- Windows on ARM is not a native support target because the selected Windows native keyboard binary is x64.

## Alternatives considered

- Keep Windows-only native modules behind dynamic imports: rejected because it hides unsupported behavior instead of providing macOS support.
- Use AppleScript for missing media keys: rejected because behavior depends on the foreground application and does not provide a general keyboard event.
- Use `fs.rename` or copy directly to the final macOS filename: rejected because those paths can overwrite or expose a partial destination, violating ADR-0006.
- Publish one universal DMG immediately: deferred because separate artifacts avoid native-module merge ambiguity and are directly testable on each architecture.
