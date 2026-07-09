# 0001. Desktop stack: electron-vite + contextIsolation IPC

- Status: accepted

## Context

Legacy desktop used Vue CLI + `vue-cli-plugin-electron-builder`, Electron 13, `nodeIntegration: true`, and `@electron/remote`. That stack is unmaintained and unsafe by current Electron guidance.

## Decision

Rebuild desktop on official `electron-vite` (Vue + TypeScript) with:

- `contextIsolation: true`, `nodeIntegration: false`
- Preload `contextBridge` API (`window.api`) for all privileged calls
- UDP/TCP, filesystem, dialogs, keyboard automation, and persistence in the main process
- Pinia instead of Vuex; Ant Design Vue retained and upgraded
- `@nut-tree-fork/nut-js` instead of `robotjs` for Command key taps

## Consequences

- Renderer cannot touch Node APIs directly; all Session I/O goes through IPC.
- Native modules rebuild via electron-builder / `@electron/rebuild`.
- Protocol behavior stays compatible with mobile; only process boundaries change.
