import { NativeModule, requireOptionalNativeModule } from 'expo';

import type {
  AlarmKitAuthorizationState,
  SyncerAlarmKitEvents,
} from './SyncerAlarmKit.types';

declare class SyncerAlarmKitModule extends NativeModule<SyncerAlarmKitEvents> {
  readonly isSupported: boolean;
  getAuthorizationStateAsync(): Promise<AlarmKitAuthorizationState>;
  requestAuthorizationAsync(): Promise<boolean>;
  startAsync(requestId: string): Promise<boolean>;
  dismissAsync(requestId: string): Promise<void>;
  clearOrphanedAlarmsAsync(): Promise<void>;
  consumeStoppedRequestIdsAsync(): Promise<string[]>;
}

export default requireOptionalNativeModule<SyncerAlarmKitModule>('SyncerAlarmKit');
