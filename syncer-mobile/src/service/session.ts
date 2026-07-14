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
import { createAudioPlayer, setAudioModeAsync, type AudioPlayer } from 'expo-audio';
import * as Clipboard from 'expo-clipboard';
import { Directory, File, FileMode, Paths, type FileHandle } from 'expo-file-system';
import React from 'react';
import { Text, Vibration, View } from 'react-native';
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
import { notify } from '../utils/notify';
import {
  ExclusiveOwnership,
  LatestStateCoordinator,
  RestorableValueSnapshot,
  SerialTaskQueue,
} from './coordinators';
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

const stagingBudget = new StagingBudget();
const ringState = new LatestStateCoordinator(false);
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
let ringActive = false;
let ringModalToken: ModalToken | null = null;
let outgoingRingModalToken: ModalToken | null = null;

Modal.subscribeAvailability(showNextCompletedBatch);

export async function initializeSessionStorage(): Promise<void> {
  await SyncerStorage.initializeAsync();
  await initializeReceiveHistory();
  const incoming = new Directory(Paths.cache, 'syncer', 'incoming');
  if (incoming.exists) incoming.delete();
  incoming.create({ intermediates: true });
}

function setIncomingRingActive(active: boolean): Promise<void> {
  return ringState.set(active, reconcileRingState);
}

function showIncomingRingModal(recovery = false): void {
  ringModalToken = Modal.show({
    key: 'incoming-ring',
    title: '查找设备',
    priority: 'urgent',
    content: React.createElement(
      Text,
      null,
      recovery ? '设备音量恢复失败，点击重试' : '你的设备正在被查找，点击停止响铃',
    ),
    footer: React.createElement(
      View,
      { style: modalStyles.button },
      React.createElement(
        ModalButton,
        {
          onPress: () => {
            void setIncomingRingActive(false).catch((error) => {
              console.error('Failed to restore Find Device resources', error);
              showFeedback('音量恢复失败', FeedbackDuration.LONG);
            });
          },
        },
        recovery ? '重试' : '停止',
      ),
    ),
  });
}

async function reconcileRingState(desired: () => boolean): Promise<void> {
  if (desired()) await startRingResources();
  if (!desired()) await stopRingResources();
}

async function startRingResources(): Promise<void> {
  if (ringActive) return;
  ringActive = true;
  try {
    Vibration.vibrate([0, 1000, 1000], true);
    await volumeSnapshot.capture(async () => (await VolumeManager.getVolume()).volume);
    if (!ringState.value) return stopRingResources();
    await VolumeManager.setVolume(1);
    if (!ringState.value) return stopRingResources();
    await setAudioModeAsync({
      playsInSilentMode: true,
      shouldPlayInBackground: true,
    });
    if (!ringState.value) return stopRingResources();

    if (!player) player = createAudioPlayer(require('../assets/ring.mp3'));
    player.loop = true;
    player.volume = 1;
    await player.seekTo(0);
    if (!ringState.value) return stopRingResources();
    player.play();
    showIncomingRingModal();
  } catch (error) {
    ringState.replaceDesired(false);
    try {
      await stopRingResources();
    } catch (cleanupError) {
      throw new AggregateError(
        [error, cleanupError],
        'Find Device failed and its resources could not be restored',
      );
    }
    throw error;
  }
}

async function stopRingResources(): Promise<void> {
  ringActive = false;
  Vibration.cancel();
  player?.pause();
  try {
    await volumeSnapshot.restore((volume) => VolumeManager.setVolume(volume));
  } catch (error) {
    showIncomingRingModal(true);
    throw error;
  }
  if (ringModalToken !== null) Modal.hide(ringModalToken);
  ringModalToken = null;
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

function handleApplicationMessage(message: TcpApplicationMessage): void | Promise<void> {
  switch (message.type) {
    case 'text':
      handleText(message.content);
      return;
    case 'ring':
      return setIncomingRingActive(message.content).catch((error) => {
        console.error('Failed to update Find Device feedback', error);
        showFeedback('响铃失败', FeedbackDuration.LONG);
      });
    case 'command':
      return;
  }
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

function enterAvailable(): void {
  const previous = channel;
  channel = null;
  generation += 1;
  interruptReceivingBatch();
  localDisconnect = false;
  remoteDisconnect = false;
  store.setTarget(null);
  store.transitionSession('settle-available');
  hideOutgoingRingModal();
  void setIncomingRingActive(false).catch((error) =>
    console.error('Failed to stop Find Device feedback', error),
  );
  previous?.destroy();
}

function handleChannelClose(closedGeneration: number): void {
  if (closedGeneration !== generation) return;
  channel = null;
  interruptReceivingBatch();
  hideOutgoingRingModal();
  void setIncomingRingActive(false).catch((error) =>
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
  hideOutgoingRingModal();
  void setIncomingRingActive(false).catch((error) =>
    console.error('Failed to stop Find Device feedback', error),
  );
  previous?.destroy();

  try {
    channel = new SessionChannel(socket, {
      onMessage: handleApplicationMessage,
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
    const activeChannel = channel;
    if (!activeChannel || store.status !== 'connected') {
      hideOutgoingRingModal();
      return;
    }
    await activeChannel.send({ type: 'ring', content: false });
    if (channel === activeChannel) hideOutgoingRingModal();
    return;
  }

  const activeChannel = channel;
  if (!activeChannel || store.status !== 'connected') throw new Error('No active Session');
  await activeChannel.send({ type: 'ring', content: true });
  if (channel !== activeChannel || store.status !== 'connected') return;

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
  hideOutgoingRingModal();
  void setIncomingRingActive(false).catch((error) =>
    console.error('Failed to stop Find Device feedback', error),
  );

  const active = channel;
  if (!active) {
    enterAvailable();
    return;
  }

  if (notifyPeer) await active.disconnect();
  else active.destroy();
}
