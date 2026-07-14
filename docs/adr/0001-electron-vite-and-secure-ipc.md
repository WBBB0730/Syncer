# 0001. Desktop stack: electron-vite + contextIsolation IPC

- Status: accepted

## Context

Legacy desktop used Vue CLI + `vue-cli-plugin-electron-builder`, Electron 13, `nodeIntegration: true`, and `@electron/remote`. That stack is unmaintained and unsafe by current Electron guidance. Preserving obsolete Windows releases would also prevent the desktop client from following Electron's supported release line.

## Decision

Rebuild the Windows 10+ and macOS 14+ desktop client on Electron 43 and official `electron-vite` (Vue + TypeScript) with:

- `contextIsolation: true`, `nodeIntegration: false`
- Serve packaged renderer assets from a standard, secure `app` protocol restricted to the renderer output directory. Keep the historical `app://./` origin so the one-time migration can read the deployed renderer `localStorage` without granting filesystem-wide `file://` access.
- Preload `contextBridge` API (`window.api`) for all privileged calls
- Expose only product-specific methods and events; do not expose a generic `ipcRenderer`, `webFrame`, process environment, or unrestricted Electron toolkit bridge
- Define each IPC payload and snapshot type once in a shared desktop contract consumed by main, preload, and renderer
- UDP/TCP, filesystem, dialogs, keyboard automation, and persistence in the main process
- The renderer subscribes to all main-process events before sending one typed readiness message containing only the five historical storage values. The main process atomically imports them when the JSON store is absent, creates application state, opens the network stack, and only then shows the window.
- The default Electron session denies permissions except notifications and sanitized clipboard writes requested by the trusted main renderer. Permission checks use the trusted renderer origin and main-frame identity rather than granting capabilities to arbitrary WebContents.
- Harden the packaged runtime with Electron Fuses: disable `RunAsNode`, Node options, CLI inspection, and extra `file://` privileges; require ASAR integrity and load the application only from ASAR.
- Pinia instead of Vuex; Ant Design Vue retained and upgraded
- Use the typed public API from `@nut-tree-fork/nut-js` instead of the unmaintained `robotjs`; platform support, key mapping, and macOS Accessibility behavior are defined by ADR-0009

## Consequences

- Renderer cannot touch Node APIs directly; all Session I/O goes through IPC.
- Existing Device identity, Whitelist, Receive History, and save directory survive the process-boundary migration; startup network events cannot race ahead of renderer listeners.
- Native modules rebuild via electron-builder / `@electron/rebuild`.
- Windows versions older than Windows 10 and macOS versions older than macOS 14 are not supported; maintaining separate native automation binaries solely for those systems is intentionally rejected.
- Desktop and mobile must implement the same current Protocol Version; Presence, Session, and wire compatibility are governed by ADR-0004 and ADR-0005 rather than this process-boundary decision.

## References

- [Electron security checklist](https://www.electronjs.org/docs/latest/tutorial/security)
- [Electron releases](https://www.electronjs.org/releases/stable)
