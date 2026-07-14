import {
  FILE_CHUNK_BYTES,
  FramedSocket,
  SessionChannel,
  StagingBudget,
  fileNameSchema,
  type AvailableDevice,
  type FileMetadata,
  type OutgoingFile,
  type StagingReservation,
  type TcpApplicationMessage,
} from '@syncer/protocol';
import {
  createAudioPlayer,
  setAudioModeAsync,
  setIsAudioActiveAsync,
  type AudioPlayer,
} from 'expo-audio';
import * as Clipboard from 'expo-clipboard';
import { Directory, File, FileMode, Paths, type FileHandle } from 'expo-file-system';
import React from 'react';
import { Platform, Text, Vibration, View } from 'react-native';
import uuid from 'react-native-uuid';
import { VolumeManager } from 'react-native-volume-manager';

import SyncerStorage, { type SaveFileInput } from '../../modules/syncer-storage';
import { Modal, ModalButton, modalStyles, type ModalToken } from '../components/Modal';
import {
  initializeReceiveHistory,
  prependReceiveHistory,
  type ReceiveHistoryItem,
} from '../repositories/receiveHistory';
import { createPublishedReceiveHistory } from '../repositories/receiveHistoryModel';
import store from '../store';
import { FeedbackDuration, showFeedback } from '../utils/feedback';
import {
  dismissFindDeviceNotification,
  notify,
  showFindDeviceNotification,
} from '../utils/notify';
import {
  ExclusiveOwnership,
  LatestStateCoordinator,
  RestorableValueSnapshot,
  SerialTaskQueue,
} from './coordinators';
import {
  dismissFindDeviceAlarmKit,
  prepareFindDeviceAlarmKitForStart,
  startFindDeviceAlarmKit,
} from './alarmKit';
import {
  setVerifiedVolume,
  startPreferredFindDeviceFeedback,
  type FindDeviceFeedbackBackend,
} from './findDevice';
import { PublicationLedger } from './publication';
import { publishRemainingFiles } from './sequentialPublication';

export type SelectedFile = Readonly<{
  uri: string;
  name: string;
  mimeType?: string | null;
}>;

type StagedFile = FileMetadata & { sourceUri: string };
type ReceivingFile = {
  metadata: FileMetadata;
  file: File;
  handle: FileHandle;
};
type ReceivingBatch = {
  directory: Directory;
  publication: PublicationLedger<StagedFile, ReceiveHistoryItem>;
  current: ReceivingFile | null;
  reservation: StagingReservation;
  state: 'receiving' | 'pending' | 'saving';
  downloadsPath: string;
};
type CompletedBatch = ReceivingBatch;
type IncomingRingRequest = Readonly<{
  requestId: string;
  sourceChannel: SessionChannel;
  sessionGeneration: number;
}>;
type PendingIncomingRingStop = {
  request: IncomingRingRequest;
  phase: 'cleanup-pending' | 'ack-pending';
  inFlight: Promise<void> | null;
};
type OutgoingRingRequest = Readonly<{
  requestId: string;
  sourceChannel: SessionChannel;
  sessionGeneration: number;
}>;
type ActiveRingFeedback = Readonly<{
  requestId: string;
  backend: FindDeviceFeedbackBackend;
}>;

const stagingBudget = new StagingBudget();
const ringState = new LatestStateCoordinator<IncomingRingRequest | null>(null);
const volumeSnapshot = new RestorableValueSnapshot<number>();
const saveQueue = new SerialTaskQueue();
const completedBatches: CompletedBatch[] = [];
const orphanedCleanupBatches = new Set<ReceivingBatch>();
const receivingBatchOwnership = new ExclusiveOwnership<ReceivingBatch>((active) =>
  store.setReceivingFileTransfer(active),
);

let channel: SessionChannel | null = null;
let generation = 0;
let localDisconnect = false;
let remoteDisconnect = false;
let displayedBatch: { batch: CompletedBatch; token: ModalToken } | null = null;
let player: AudioPlayer | null = null;
let audioSessionActive = false;
let activeIncomingRing: IncomingRingRequest | null = null;
let activeRingFeedback: ActiveRingFeedback | null = null;
let ringModalToken: ModalToken | null = null;
let ringRecoveryRequestId: string | null = null;
let outgoingRingModalToken: ModalToken | null = null;
let outgoingRingRequest: OutgoingRingRequest | null = null;
const pendingIncomingRingStops = new Map<string, PendingIncomingRingStop>();
const ringNotificationIdentifiers = new Map<string, string>();

Modal.subscribeAvailability(showNextCompletedBatch);

export async function initializeSessionStorage(): Promise<void> {
  await SyncerStorage.initializeAsync();
  await initializeReceiveHistory();
  const incoming = new Directory(Paths.cache, 'syncer', 'incoming');
  if (incoming.exists) incoming.delete();
  incoming.create({ intermediates: true });
}

function setIncomingRingRequest(request: IncomingRingRequest | null): Promise<void> {
  return ringState.set(request, reconcileRingState);
}

function stopCurrentIncomingRing(request: IncomingRingRequest): Promise<void> {
  if (ringState.value?.requestId === request.requestId) {
    ringState.replaceDesired(null);
  }
  return ringState.runExclusive(() => stopRingResources(request.requestId));
}

function showIncomingRingModal(request: IncomingRingRequest): void {
  ringRecoveryRequestId = null;
  ringModalToken = Modal.show({
    key: 'incoming-ring',
    title: '查找设备',
    priority: 'urgent',
    content: React.createElement(Text, null, '你的设备正在被查找，点击停止响铃'),
    footer: React.createElement(
      View,
      { style: modalStyles.button },
      React.createElement(
        ModalButton,
        {
          onPress: () => {
            void stopIncomingFindDevice(request.requestId).catch((error) => {
              console.error('Failed to restore Find Device resources', error);
              showFeedback('停止响铃失败', FeedbackDuration.LONG);
            });
          },
        },
        '停止',
      ),
    ),
  });
}

function showIncomingRingRecoveryModal(requestId: string | null): void {
  ringRecoveryRequestId = requestId;
  ringModalToken = Modal.show({
    key: 'incoming-ring',
    title: '查找设备',
    priority: 'urgent',
    content: React.createElement(Text, null, '设备状态恢复失败，点击重试'),
    footer: React.createElement(
      View,
      { style: modalStyles.button },
      React.createElement(
        ModalButton,
        {
          onPress: () => {
            const pending = requestId
              ? pendingIncomingRingStops.get(requestId)
              : pendingIncomingRingStops.values().next().value;
            const retry = pending
              ? stopIncomingFindDevice(pending.request.requestId)
              : setIncomingRingRequest(null);
            void retry.catch((error) => {
              console.error('Failed to retry Find Device resource restoration', error);
              showFeedback('设备状态恢复失败', FeedbackDuration.LONG);
            });
          },
        },
        '重试',
      ),
    ),
  });
}

async function reconcileRingState(desired: () => IncomingRingRequest | null): Promise<void> {
  const request = desired();
  if (!request) {
    await stopRingResources();
    return;
  }
  if (
    activeIncomingRing?.requestId === request.requestId &&
    activeRingFeedback?.requestId === request.requestId
  ) {
    return;
  }
  if (hasRingResources()) await stopRingResources();
  if (desired()?.requestId === request.requestId) await startRingResources(request);
}

async function startRingResources(request: IncomingRingRequest): Promise<void> {
  activeIncomingRing = request;
  try {
    if (Platform.OS === 'ios') {
      activeRingFeedback = { requestId: request.requestId, backend: 'alarmkit' };
      const result = await startPreferredFindDeviceFeedback({
        prepareAlarmKit: prepareFindDeviceAlarmKitForStart,
        startAlarmKit: () => startFindDeviceAlarmKit(request.requestId),
        dismissAlarmKit: () => dismissFindDeviceAlarmKit(request.requestId),
        startLegacy: async () => {
          activeRingFeedback = { requestId: request.requestId, backend: 'legacy' };
          await startLegacyRingResources(request);
        },
      });
      if (result.alarmKitError) {
        console.warn('AlarmKit failed; using legacy Find Device feedback', result.alarmKitError);
      }
    } else {
      activeRingFeedback = { requestId: request.requestId, backend: 'legacy' };
      await startLegacyRingResources(request);
    }

    if (!isDesiredRing(request)) return stopRingResources(request.requestId);
    showIncomingRingModal(request);
  } catch (error) {
    const failedCurrentRequest = isDesiredRing(request);
    if (failedCurrentRequest) {
      ringState.replaceDesired(null);
      pendingIncomingRingStops.set(request.requestId, {
        request,
        phase: 'cleanup-pending',
        inFlight: null,
      });
    }
    const errors: unknown[] = [error];
    let cleanupSucceeded = false;
    try {
      await stopRingResources(request.requestId);
      cleanupSucceeded = true;
    } catch (cleanupError) {
      errors.push(cleanupError);
    }
    if (failedCurrentRequest && cleanupSucceeded) {
      try {
        const pending = pendingIncomingRingStops.get(request.requestId);
        if (pending) pending.phase = 'ack-pending';
        await acknowledgeIncomingFindDeviceStopped(request);
        await completeIncomingFindDeviceStop(request);
      } catch (acknowledgementError) {
        await ensureFindDeviceNotification(request.requestId);
        showIncomingRingRecoveryModal(request.requestId);
        errors.push(acknowledgementError);
      }
    } else if (failedCurrentRequest) {
      await ensureFindDeviceNotification(request.requestId);
    }
    if (errors.length === 1) throw error;
    throw new AggregateError(errors, 'Find Device failed and could not be fully stopped');
  }
}

async function startLegacyRingResources(request: IncomingRingRequest): Promise<void> {
  Vibration.vibrate([0, 1000, 1000], true);
  if (Platform.OS === 'android') await volumeSnapshot.capture(readMediaVolume);
  if (!isDesiredRing(request)) return stopRingResources(request.requestId);
  await setAudioModeAsync({
    playsInSilentMode: true,
    shouldPlayInBackground: true,
    interruptionMode: 'doNotMix',
  });
  if (!isDesiredRing(request)) return stopRingResources(request.requestId);
  await setIsAudioActiveAsync(true);
  audioSessionActive = true;
  if (!isDesiredRing(request)) return stopRingResources(request.requestId);

  if (!player) player = createAudioPlayer(require('../assets/ring.mp3'));
  player.loop = true;
  player.volume = 1;
  await player.seekTo(0);
  if (!isDesiredRing(request)) return stopRingResources(request.requestId);

  if (Platform.OS === 'android') await setMediaVolume(1);
  if (!isDesiredRing(request)) return stopRingResources(request.requestId);

  player.play();
  await waitForPlaybackStart(request);
  if (!isDesiredRing(request)) return stopRingResources(request.requestId);

  const identifier = await showFindDeviceNotification(request.requestId);
  ringNotificationIdentifiers.set(request.requestId, identifier);
  if (!isDesiredRing(request)) return stopRingResources(request.requestId);
}

async function stopRingResources(expectedRequestId?: string): Promise<void> {
  const ownedRequestId = activeIncomingRing?.requestId ?? activeRingFeedback?.requestId;
  if (expectedRequestId && ownedRequestId && expectedRequestId !== ownedRequestId) return;

  const errors: unknown[] = [];
  const feedback = activeRingFeedback;
  activeIncomingRing = null;

  if (ringModalToken !== null) Modal.hide(ringModalToken);
  ringModalToken = null;
  ringRecoveryRequestId = null;

  if (feedback?.backend === 'alarmkit') {
    try {
      await dismissFindDeviceAlarmKit(feedback.requestId);
    } catch (error) {
      errors.push(error);
    }
  } else {
    try {
      Vibration.cancel();
    } catch (error) {
      errors.push(error);
    }
    try {
      player?.pause();
    } catch (error) {
      errors.push(error);
    }

    try {
      if (Platform.OS === 'android') await volumeSnapshot.restore(setMediaVolume);
    } catch (error) {
      errors.push(error);
    }

    if (audioSessionActive) {
      try {
        await setIsAudioActiveAsync(false);
        audioSessionActive = false;
      } catch (error) {
        errors.push(error);
      }
    }
  }

  for (const [requestId, identifier] of [...ringNotificationIdentifiers]) {
    if (pendingIncomingRingStops.has(requestId)) continue;
    try {
      await dismissFindDeviceNotification(identifier);
      ringNotificationIdentifiers.delete(requestId);
    } catch (error) {
      errors.push(error);
    }
  }

  if (errors.length > 0) {
    showIncomingRingRecoveryModal(expectedRequestId ?? feedback?.requestId ?? ownedRequestId ?? null);
    throw new AggregateError(errors, 'Failed to restore Find Device resources');
  }
  activeRingFeedback = null;
}

function hasRingResources(): boolean {
  return (
    activeIncomingRing !== null ||
    activeRingFeedback !== null ||
    volumeSnapshot.hasValue ||
    audioSessionActive ||
    ringNotificationIdentifiers.size > 0 ||
    ringModalToken !== null
  );
}

function isDesiredRing(request: IncomingRingRequest): boolean {
  return ringState.value?.requestId === request.requestId;
}

async function waitForPlaybackStart(request: IncomingRingRequest): Promise<void> {
  const maximumAttempts = 10;
  for (let attempt = 1; attempt <= maximumAttempts; attempt += 1) {
    if (!isDesiredRing(request) || player?.currentStatus.playing) return;
    if (attempt < maximumAttempts) await delay(100);
  }
  throw new Error('Find Device audio did not start playing');
}

async function readMediaVolume(): Promise<number> {
  const volume = (await VolumeManager.getVolume()).volume;
  if (!Number.isFinite(volume) || volume < 0 || volume > 1) {
    throw new Error(`Invalid media volume: ${volume}`);
  }
  return volume;
}

function setMediaVolume(volume: number): Promise<void> {
  return setVerifiedVolume({
    target: volume,
    read: readMediaVolume,
    write: (nextVolume) =>
      VolumeManager.setVolume(nextVolume, {
        type: 'music',
        showUI: false,
        playSound: false,
      }),
  });
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function handleText(content: string): void {
  notify(store.name, '向你发送了一段文本');
  const copy = (): void => {
    void Clipboard.setStringAsync(content)
      .then(() => showFeedback('已复制到剪贴板'))
      .catch((error) => {
        console.error('Failed to copy received text', error);
        showFeedback('复制失败', FeedbackDuration.LONG);
      });
  };
  Modal.show({
    key: 'received-text',
    title: '收到文本',
    content: React.createElement(Text, null, content),
    footer: React.createElement(
      React.Fragment,
      null,
      React.createElement(
        View,
        { style: modalStyles.button },
        React.createElement(ModalButton, { type: 'outline', onPress: () => Modal.hide() }, '忽略'),
      ),
      React.createElement(
        View,
        { style: modalStyles.button },
        React.createElement(ModalButton, { onPress: copy }, '复制'),
      ),
    ),
  });
}

function handleApplicationMessage(
  message: TcpApplicationMessage,
  sessionGeneration: number,
): void | Promise<void> {
  if (sessionGeneration !== generation || !channel) return;
  switch (message.type) {
    case 'text':
      handleText(message.content);
      return;
    case 'ring':
      return handleIncomingRingMessage(message, channel, sessionGeneration).catch((error) => {
        console.error('Failed to update Find Device feedback', error);
        showFeedback('响铃失败', FeedbackDuration.LONG);
      });
    case 'command':
      return;
  }
}

function handleIncomingRingMessage(
  message: Extract<TcpApplicationMessage, { type: 'ring' }>,
  sourceChannel: SessionChannel,
  sessionGeneration: number,
): Promise<void> {
  const { content: active, requestId } = message;
  if (!active) {
    if (
      outgoingRingRequest?.requestId === requestId &&
      outgoingRingRequest.sourceChannel === sourceChannel &&
      outgoingRingRequest.sessionGeneration === sessionGeneration
    ) {
      outgoingRingRequest = null;
      hideOutgoingRingModal();
    }

    const pending = pendingIncomingRingStops.get(requestId);
    const matchingPending =
      pending?.request.sourceChannel === sourceChannel &&
      pending.request.sessionGeneration === sessionGeneration
        ? pending
        : null;
    if (matchingPending) {
      pendingIncomingRingStops.delete(requestId);
    }

    const current = ringState.value;
    if (
      current?.requestId === requestId &&
      current.sourceChannel === sourceChannel &&
      current.sessionGeneration === sessionGeneration
    ) {
      return stopCurrentIncomingRing(current);
    }

    if (matchingPending) return dismissRingNotification(requestId);
    return Promise.resolve();
  }

  const pending = pendingIncomingRingStops.get(requestId);
  if (
    pending?.request.sourceChannel === sourceChannel &&
    pending.request.sessionGeneration === sessionGeneration
  ) {
    return stopIncomingFindDevice(requestId);
  }

  const current = ringState.value;
  if (
    current?.requestId === requestId &&
    current?.sourceChannel === sourceChannel &&
    current.sessionGeneration === sessionGeneration
  ) {
    return Promise.resolve();
  }
  return setIncomingRingRequest({
    requestId,
    sourceChannel,
    sessionGeneration,
  });
}

export async function stopIncomingFindDevice(requestId: string): Promise<void> {
  let pending = pendingIncomingRingStops.get(requestId);
  if (!pending) {
    const request = ringState.value;
    if (!request || request.requestId !== requestId) return;
    pending = { request, phase: 'cleanup-pending', inFlight: null };
    pendingIncomingRingStops.set(requestId, pending);
  }
  if (pending.inFlight) return pending.inFlight;

  const operation = performIncomingFindDeviceStop(pending);
  pending.inFlight = operation;
  try {
    await operation;
  } finally {
    if (pending.inFlight === operation) pending.inFlight = null;
  }
}

async function performIncomingFindDeviceStop(pending: PendingIncomingRingStop): Promise<void> {
  const { request } = pending;
  if (pending.phase === 'cleanup-pending') {
    try {
      const ownedRequestId = activeIncomingRing?.requestId ?? activeRingFeedback?.requestId;
      if (
        ringState.value?.requestId === request.requestId ||
        ownedRequestId === request.requestId
      ) {
        await stopCurrentIncomingRing(request);
      }
      pending.phase = 'ack-pending';
    } catch (error) {
      await ensureFindDeviceNotification(request.requestId);
      showIncomingRingRecoveryModal(request.requestId);
      throw error;
    }
  }

  try {
    await acknowledgeIncomingFindDeviceStopped(request);
  } catch (error) {
    await ensureFindDeviceNotification(request.requestId);
    showIncomingRingRecoveryModal(request.requestId);
    throw error;
  }
  await completeIncomingFindDeviceStop(request);
}

async function acknowledgeIncomingFindDeviceStopped(request: IncomingRingRequest): Promise<void> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const pending = pendingIncomingRingStops.get(request.requestId);
    if (!pending || pending.request !== request) return;
    if (
      channel !== request.sourceChannel ||
      generation !== request.sessionGeneration ||
      store.status !== 'connected'
    ) {
      return;
    }
    try {
      await request.sourceChannel.send({
        type: 'ring',
        content: false,
        requestId: request.requestId,
      });
      return;
    } catch (error) {
      lastError = error;
      if (attempt < 3) await delay(100);
    }
  }
  throw lastError;
}

async function completeIncomingFindDeviceStop(request: IncomingRingRequest): Promise<void> {
  const pending = pendingIncomingRingStops.get(request.requestId);
  if (!pending || pending.request !== request) return;
  pendingIncomingRingStops.delete(request.requestId);
  if (ringRecoveryRequestId === request.requestId) {
    if (ringModalToken !== null) Modal.hide(ringModalToken);
    ringModalToken = null;
    ringRecoveryRequestId = null;
  }
  try {
    await dismissRingNotification(request.requestId);
  } catch (error) {
    console.warn('Failed to dismiss stopped Find Device notification', error);
  }
}

async function ensureFindDeviceNotification(requestId: string): Promise<void> {
  try {
    const identifier = await showFindDeviceNotification(requestId);
    ringNotificationIdentifiers.set(requestId, identifier);
  } catch (error) {
    console.warn('Failed to preserve Find Device notification for retry', error);
  }
}

async function dismissRingNotification(requestId: string): Promise<void> {
  const identifier = ringNotificationIdentifiers.get(requestId);
  if (!identifier) return;
  await dismissFindDeviceNotification(identifier);
  ringNotificationIdentifiers.delete(requestId);
}

function beginReceivingBatch(files: readonly FileMetadata[]): void {
  if (receivingBatchOwnership.current) {
    throw new Error('A File Transfer batch is already being staged');
  }
  retryOrphanedCleanups();
  const reservation = stagingBudget.reserve(files.reduce((total, file) => total + file.size, 0));
  let directory: Directory;
  try {
    directory = new Directory(Paths.cache, 'syncer', 'incoming', String(uuid.v4()));
    directory.create({ intermediates: true });
  } catch (error) {
    reservation.release();
    throw error;
  }
  receivingBatchOwnership.acquire({
    directory,
    publication: new PublicationLedger(),
    current: null,
    reservation,
    state: 'receiving',
    downloadsPath: '',
  });
}

function beginReceivingFile(metadata: FileMetadata): void {
  const batch = receivingBatchOwnership.current;
  if (!batch || batch.current) throw new Error('File Transfer staging is not ready');
  const file = new File(batch.directory, `${String(uuid.v4())}.part`);
  file.create();
  batch.current = {
    metadata,
    file,
    handle: file.open(FileMode.Truncate),
  };
}

function writeReceivingChunk(metadata: FileMetadata, chunk: Uint8Array): void {
  const current = receivingBatchOwnership.current?.current;
  if (!current || current.metadata.id !== metadata.id) {
    throw new Error('File Transfer chunk does not match the staged file');
  }
  current.handle.writeBytes(chunk);
}

function endReceivingFile(metadata: FileMetadata): void {
  const batch = receivingBatchOwnership.current;
  const current = batch?.current;
  if (!batch || !current || current.metadata.id !== metadata.id) {
    throw new Error('File Transfer end does not match the staged file');
  }
  current.handle.close();
  batch.publication.addStaged({ ...metadata, sourceUri: current.file.uri });
  batch.current = null;
}

function completeReceivingBatch(files: readonly FileMetadata[]): void {
  const batch = receivingBatchOwnership.current;
  if (!batch || batch.current || batch.publication.remaining.length !== files.length) {
    throw new Error('File Transfer batch completed before staging finished');
  }
  receivingBatchOwnership.release();
  const completed: CompletedBatch = batch;
  completed.state = 'pending';
  completedBatches.push(completed);
  notify(store.name, `向你发送了 ${completed.publication.remaining.length} 个文件`);
  showNextCompletedBatch();
}

function showNextCompletedBatch(): void {
  if (displayedBatch || completedBatches.length === 0 || !Modal.canShow()) return;
  const batch = completedBatches[0];
  if (!batch || batch.state !== 'pending') {
    throw new Error('Completed File Transfer queue lost pending ownership');
  }
  completedBatches.shift();

  try {
    const token = Modal.show({
      key: `file-receipt:${batch.directory.uri}`,
      title: '收到文件',
      content: React.createElement(
        React.Fragment,
        null,
        ...[
          ...batch.publication.pendingHistory.map((item) => ({
            key: `history:${item.locator}`,
            name: item.name,
          })),
          ...batch.publication.remaining.map((file) => ({
            key: `staged:${file.id}`,
            name: file.name,
          })),
        ].map((item) =>
          React.createElement(Text, { key: item.key, style: { marginBottom: 8 } }, item.name),
        ),
      ),
      footer: React.createElement(
        React.Fragment,
        null,
        React.createElement(
          View,
          { style: modalStyles.button },
          React.createElement(
            ModalButton,
            {
              type: 'outline',
              onPress: () => void ignoreCompletedBatch(batch),
            },
            '忽略',
          ),
        ),
        React.createElement(
          View,
          { style: modalStyles.button },
          React.createElement(
            ModalButton,
            { onPress: () => void saveCompletedBatch(batch) },
            '保存',
          ),
        ),
      ),
    });
    displayedBatch = { batch, token };
  } catch (error) {
    completedBatches.unshift(batch);
    throw error;
  }
}

function finishDisplayedBatch(batch: CompletedBatch): void {
  if (displayedBatch?.batch !== batch) return;
  Modal.hide(displayedBatch.token);
  displayedBatch = null;
}

function cleanupStagedBatch(batch: ReceivingBatch): void {
  const errors: unknown[] = [];
  const current = batch.current;
  if (current) {
    try {
      current.handle.close();
      batch.current = null;
    } catch (error) {
      errors.push(error);
    }
  }

  try {
    if (batch.directory.exists) batch.directory.delete();
  } catch (error) {
    errors.push(error);
  }

  if (!batch.directory.exists) {
    batch.current = null;
    batch.reservation.release();
    orphanedCleanupBatches.delete(batch);
    return;
  }
  errors.push(new Error('File Transfer staging directory still exists after cleanup'));
  throw new AggregateError(errors, 'Failed to clean File Transfer staging');
}

function retireStagedBatch(batch: ReceivingBatch): void {
  try {
    cleanupStagedBatch(batch);
  } catch (error) {
    orphanedCleanupBatches.add(batch);
    console.error('Failed to clean File Transfer staging', error);
    showFeedback('临时文件清理失败', FeedbackDuration.LONG);
  }
}

function interruptReceivingBatch(): void {
  const interrupted = receivingBatchOwnership.release();
  if (interrupted) retireStagedBatch(interrupted);
}

function retryOrphanedCleanups(): void {
  for (const batch of orphanedCleanupBatches) {
    try {
      cleanupStagedBatch(batch);
    } catch (error) {
      console.warn('File Transfer staging cleanup is still pending', error);
    }
  }
}

function cleanupPublishedStaging(batch: CompletedBatch): void {
  const errors: unknown[] = [];
  for (const staged of [...batch.publication.pendingCleanup]) {
    try {
      const file = new File(staged.sourceUri);
      if (file.exists) file.delete();
      if (file.exists) throw new Error(`Published staging file still exists: ${staged.sourceUri}`);
      const released = batch.publication.acknowledgeCleanup(staged.sourceUri);
      batch.reservation.releaseBytes(released.size);
    } catch (error) {
      errors.push(error);
    }
  }
  if (errors.length > 0) {
    console.error('Failed to clean published File Transfer staging', ...errors);
    showFeedback('临时文件清理失败', FeedbackDuration.LONG);
  }
}

async function ignoreCompletedBatch(batch: CompletedBatch): Promise<void> {
  if (displayedBatch?.batch !== batch || batch.state !== 'pending') return;
  batch.state = 'saving';
  finishDisplayedBatch(batch);
  await saveQueue.run(async () => {
    try {
      await flushPendingHistory(batch);
      retireStagedBatch(batch);
    } catch (error) {
      console.error('Failed to record published files before ignoring the batch', error);
      batch.state = 'pending';
      completedBatches.unshift(batch);
      showFeedback('接收历史写入失败', FeedbackDuration.LONG);
    }
    showNextCompletedBatch();
  });
}

async function saveCompletedBatch(batch: CompletedBatch): Promise<void> {
  if (displayedBatch?.batch !== batch || batch.state !== 'pending') return;
  batch.state = 'saving';
  finishDisplayedBatch(batch);
  await saveQueue.run(() => publishCompletedBatch(batch));
}

async function publishCompletedBatch(batch: CompletedBatch): Promise<void> {
  let publishedCount = 0;
  try {
    cleanupPublishedStaging(batch);
    await flushPendingHistory(batch);
    if (batch.publication.remaining.length === 0) {
      retireStagedBatch(batch);
      showFeedback(`已保存到${batch.downloadsPath}`, FeedbackDuration.LONG);
      showNextCompletedBatch();
      return;
    }

    await publishRemainingFiles(
      () => batch.publication.remaining,
      async (staged, complete) => {
        const file: SaveFileInput = {
          sourceUri: staged.sourceUri,
          name: staged.name,
          size: staged.size,
          mimeType: staged.mimeType,
        };
        const result = await SyncerStorage.saveFileAsync(file);
        const history = createPublishedReceiveHistory([result.file], Date.now());
        batch.publication.recordPublication([result.file], history, complete);
        batch.downloadsPath = result.downloadsPath;
        publishedCount += 1;
        cleanupPublishedStaging(batch);
        await flushPendingHistory(batch);
      },
    );

    retireStagedBatch(batch);
    showFeedback(`已保存到${batch.downloadsPath}`, FeedbackDuration.LONG);
    showNextCompletedBatch();
  } catch (error) {
    console.error('Failed to save received files', error);
    batch.state = 'pending';
    completedBatches.unshift(batch);
    showFeedback(
      batch.publication.pendingHistory.length > 0
        ? '文件已保存，但接收历史写入失败'
        : publishedCount > 0
          ? `部分文件已保存到${batch.downloadsPath}`
          : '保存失败',
      FeedbackDuration.LONG,
    );
    showNextCompletedBatch();
  }
}

async function flushPendingHistory(batch: CompletedBatch): Promise<void> {
  const pending = [...batch.publication.pendingHistory];
  if (pending.length === 0) return;
  await prependReceiveHistory(pending);
  batch.publication.acknowledgeHistory(pending);
}

function hideOutgoingRingModal(): void {
  if (outgoingRingModalToken !== null) Modal.hide(outgoingRingModalToken);
  outgoingRingModalToken = null;
}

function clearFindDeviceSessionState(): void {
  outgoingRingRequest = null;
  hideOutgoingRingModal();
  pendingIncomingRingStops.clear();
}

function enterAvailable(): void {
  const previous = channel;
  channel = null;
  generation += 1;
  interruptReceivingBatch();
  localDisconnect = false;
  remoteDisconnect = false;
  store.setTarget(null);
  store.transitionSession('settle-available');
  clearFindDeviceSessionState();
  void setIncomingRingRequest(null).catch((error) =>
    console.error('Failed to stop Find Device feedback', error),
  );
  previous?.destroy();
}

function handleChannelClose(closedGeneration: number): void {
  if (closedGeneration !== generation) return;
  channel = null;
  interruptReceivingBatch();
  clearFindDeviceSessionState();
  void setIncomingRingRequest(null).catch((error) =>
    console.error('Failed to stop Find Device feedback', error),
  );

  const connectionLost = !localDisconnect && !remoteDisconnect;
  enterAvailable();
  if (connectionLost) {
    showFeedback('连接中断');
    notify('Syncer', '连接中断');
  }
}

export function attachSessionSocket(socket: FramedSocket, device: AvailableDevice): void {
  generation += 1;
  const currentGeneration = generation;
  const previous = channel;
  channel = null;
  interruptReceivingBatch();

  localDisconnect = false;
  remoteDisconnect = false;
  store.setTarget(device);
  store.transitionSession('attach-session');
  clearFindDeviceSessionState();
  void setIncomingRingRequest(null).catch((error) =>
    console.error('Failed to stop Find Device feedback', error),
  );
  previous?.destroy();

  try {
    channel = new SessionChannel(socket, {
      onMessage: (message) => handleApplicationMessage(message, currentGeneration),
      onFileOffer: (files) => beginReceivingBatch(files),
      onFileBegin: (file) => beginReceivingFile(file),
      onFileChunk: (file, chunk) => writeReceivingChunk(file, chunk),
      onFileEnd: (file) => endReceivingFile(file),
      onFileBatchEnd: (files) => completeReceivingBatch(files),
      onRemoteDisconnect: () => {
        remoteDisconnect = true;
      },
      onClose: () => handleChannelClose(currentGeneration),
      onError: (error) => {
        if (currentGeneration === generation) interruptReceivingBatch();
        console.warn('Session channel error', error);
      },
    });
  } catch (error) {
    socket.destroy();
    enterAvailable();
    throw error;
  }
}

export async function sendSessionMessage(message: TcpApplicationMessage): Promise<void> {
  if (!channel || store.status !== 'connected') throw new Error('No active Session');
  await channel.send(message);
}

export async function setFindDeviceActive(active: boolean): Promise<void> {
  if (!active) {
    const request = outgoingRingRequest;
    if (!request) {
      hideOutgoingRingModal();
      return;
    }
    if (
      channel !== request.sourceChannel ||
      generation !== request.sessionGeneration ||
      store.status !== 'connected'
    ) {
      if (outgoingRingRequest === request) outgoingRingRequest = null;
      hideOutgoingRingModal();
      return;
    }
    await request.sourceChannel.send({
      type: 'ring',
      content: false,
      requestId: request.requestId,
    });
    if (outgoingRingRequest === request) {
      outgoingRingRequest = null;
      hideOutgoingRingModal();
    }
    return;
  }

  const activeChannel = channel;
  if (!activeChannel || store.status !== 'connected') throw new Error('No active Session');
  if (
    outgoingRingRequest?.sourceChannel === activeChannel &&
    outgoingRingRequest.sessionGeneration === generation
  ) {
    return;
  }

  const request: OutgoingRingRequest = {
    requestId: String(uuid.v4()),
    sourceChannel: activeChannel,
    sessionGeneration: generation,
  };
  outgoingRingRequest = request;
  try {
    await activeChannel.send({ type: 'ring', content: true, requestId: request.requestId });
  } catch (error) {
    if (outgoingRingRequest === request) outgoingRingRequest = null;
    throw error;
  }
  if (
    outgoingRingRequest !== request ||
    channel !== activeChannel ||
    store.status !== 'connected'
  ) {
    return;
  }

  hideOutgoingRingModal();
  outgoingRingModalToken = Modal.show({
    key: 'outgoing-ring',
    title: '正在查找',
    content: React.createElement(Text, null, '设备正在响铃...'),
    footer: React.createElement(
      View,
      { style: modalStyles.button },
      React.createElement(
        ModalButton,
        {
          onPress: () => {
            void setFindDeviceActive(false).catch((error) => {
              console.error('Failed to stop Find Device', error);
              showFeedback('停止查找设备失败', FeedbackDuration.LONG);
            });
          },
        },
        '停止',
      ),
    ),
  });
}

export async function sendFiles(files: readonly SelectedFile[]): Promise<void> {
  if (!channel || store.status !== 'connected') throw new Error('No active Session');
  const outgoing = files.map(toOutgoingFile);
  await channel.sendFileBatch(outgoing);
}

function toOutgoingFile(selected: SelectedFile): OutgoingFile {
  const file = new File(selected.uri);
  const size = file.size;
  return {
    id: String(uuid.v4()),
    name: fileNameSchema.parse(selected.name),
    size,
    mimeType: selected.mimeType || undefined,
    chunks: () => readFileChunks(file, selected.name, size),
  };
}

async function* readFileChunks(
  file: File,
  displayName: string,
  expectedSize: number,
): AsyncIterable<Uint8Array> {
  const handle = file.open(FileMode.ReadOnly);
  let remaining = expectedSize;
  try {
    while (remaining > 0) {
      const chunk = handle.readBytes(Math.min(FILE_CHUNK_BYTES, remaining));
      if (chunk.byteLength === 0) throw new Error(`File ${displayName} changed during transfer`);
      remaining -= chunk.byteLength;
      yield chunk;
    }
    if (handle.readBytes(1).byteLength !== 0) {
      throw new Error(`File ${displayName} changed during transfer`);
    }
  } finally {
    handle.close();
  }
}

export async function disconnectSession(notifyPeer = true): Promise<void> {
  localDisconnect = true;
  interruptReceivingBatch();
  clearFindDeviceSessionState();
  try {
    await setIncomingRingRequest(null);
  } catch (error) {
    console.error('Failed to stop Find Device feedback', error);
  }

  const active = channel;
  if (!active) {
    enterAvailable();
    return;
  }

  if (notifyPeer) await active.disconnect();
  else active.destroy();
}
