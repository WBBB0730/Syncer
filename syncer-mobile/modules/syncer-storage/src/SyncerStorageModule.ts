import { NativeModule, requireNativeModule } from 'expo-modules-core';

import type { SaveFileInput, SaveFileResult } from './SyncerStorage.types';

declare class SyncerStorageModule extends NativeModule {
  readonly downloadsPath: string;
  initializeAsync(): Promise<void>;
  saveFileAsync(file: SaveFileInput): Promise<SaveFileResult>;
  migrateLegacyFileLocatorAsync(
    uri: string | null,
    path: string | null,
    name: string,
  ): Promise<string>;
  openFileAsync(locator: string): Promise<void>;
}

export default requireNativeModule<SyncerStorageModule>('SyncerStorage');
