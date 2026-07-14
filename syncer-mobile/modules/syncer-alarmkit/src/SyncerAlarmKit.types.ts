export type AlarmKitAuthorizationState = 'notDetermined' | 'authorized' | 'denied';

export type AlarmStoppedEvent = {
  requestId: string;
};

export type SyncerAlarmKitEvents = {
  onAlarmStopped(event: AlarmStoppedEvent): void;
};
