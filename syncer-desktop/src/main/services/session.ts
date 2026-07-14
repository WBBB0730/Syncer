import { randomUUID } from 'crypto'
import { createReadStream } from 'fs'
import { open, rm, stat, type FileHandle } from 'fs/promises'
import { join } from 'path'
import { app, BrowserWindow, dialog } from 'electron'
import {
  FILE_CHUNK_BYTES,
  FramedSocket,
  SessionChannel,
  StagingBudget,
  fileNameSchema,
  type AvailableDevice,
  type CommandKey,
  type FileMetadata,
  type OutgoingFile,
  type StagingReservation,
  type TcpApplicationMessage
} from '@syncer/protocol'
import {
  COMMAND_FAILED_CHANNEL,
  FIND_DEVICE_STOPPED_CHANNEL,
  type CommandFailedPayload,
  type ReceiveHistoryItem,
  type ReceivedFileBatch,
  type ReceivedFileSummary,
  type SaveFilesResult,
  type SelectedFile
} from '../../shared/contracts'
import { appState } from '../state'
import { executeKeyboardCommand, type CommandExecutionResult } from '../utils/keyboard'
import { getStorage, setStorage, STORAGE_KEYS } from '../utils/storage'
import { refreshPresenceAnnounce } from './discovery'
import { emit } from './emit'
import { FindDeviceCoordinator } from './findDevice'
import { ReceivedFileStorage, type PendingFilePublication } from './receivedFileStorage'

interface StagedFile extends FileMetadata {
  path: string
}

interface StagingOwnership {
  directory: string
  reservation: StagingReservation
  released: boolean
}

interface IncomingBatch extends StagingOwnership {
  files: StagedFile[]
  current: (StagedFile & { handle: FileHandle }) | null
}

interface ReceiptFile {
  staged: StagedFile
  pendingPublication: { publication: PendingFilePublication; time: number } | null
  publication: ReceiveHistoryItem | null
  historyRecorded: boolean
  stagingReleased: boolean
}

interface FileReceipt extends StagingOwnership {
  files: ReceiptFile[]
  operation: Promise<unknown> | null
}

interface TransferState {
  runtime: SessionRuntime
  active: boolean
  incomingBatch: IncomingBatch | null
  activeOperation: Promise<void> | null
  cleanup: Promise<void> | null
}

interface SessionOwnership {
  channel: SessionChannel | null
  transfer: TransferState
  runtime: SessionRuntime
  intentionalClose: boolean
  findDevice: FindDeviceCoordinator
}

export interface SessionRuntime {
  emit(channel: string, payload?: unknown): void
  executeCommand(command: CommandKey): CommandExecutionResult | Promise<CommandExecutionResult>
}

let activeSession: SessionOwnership | null = null

const stagingBudget = new StagingBudget()
const receipts = new Map<string, FileReceipt>()
const pendingStagingCleanup = new Set<StagingOwnership>()
const pendingTransferCleanups = new Set<Promise<void>>()
const activeReceiptOperations = new Set<Promise<unknown>>()
let receivedFileStorage: ReceivedFileStorage | null = null
let shuttingDown = false

const productionSessionRuntime: SessionRuntime = {
  emit,
  executeCommand: executeKeyboardCommand
}

function emitState(runtime: SessionRuntime): void {
  runtime.emit('syncer:state-changed', appState.snapshot())
}

function receiptRoot(): string {
  return join(app.getPath('temp'), 'Syncer', 'desktop')
}

function fileStorage(): ReceivedFileStorage {
  receivedFileStorage ??= new ReceivedFileStorage(receiptRoot(), {
    journalPath: join(app.getPath('userData'), 'received-file-publication-journal.json')
  })
  return receivedFileStorage
}

export async function initializeSessionStorage(): Promise<void> {
  shuttingDown = false
  await fileStorage().reset()
}

function createTransferState(runtime: SessionRuntime): TransferState {
  return { runtime, active: true, incomingBatch: null, activeOperation: null, cleanup: null }
}

function assertTransferStateActive(state: TransferState): void {
  if (!state.active) throw new Error('Session transfer ownership has ended')
}

async function releaseStagingOwnership(ownership: StagingOwnership): Promise<void> {
  if (ownership.released) return
  try {
    await fileStorage().remove(ownership.directory)
  } catch (error) {
    pendingStagingCleanup.add(ownership)
    throw error
  }
  ownership.reservation.release()
  ownership.released = true
  pendingStagingCleanup.delete(ownership)
}

async function retryPendingStagingCleanup(): Promise<void> {
  for (const ownership of [...pendingStagingCleanup]) {
    try {
      await releaseStagingOwnership(ownership)
    } catch (error) {
      console.error('Failed to retry File Transfer staging cleanup', error)
    }
  }
}

async function runOwnedOperation(
  state: TransferState,
  operation: () => Promise<void>
): Promise<void> {
  assertTransferStateActive(state)
  const active = operation()
  state.activeOperation = active
  try {
    await active
  } finally {
    if (state.activeOperation === active) state.activeOperation = null
  }
}

async function writeAll(handle: FileHandle, data: Uint8Array): Promise<void> {
  let offset = 0
  while (offset < data.byteLength) {
    const { bytesWritten } = await handle.write(data, offset, data.byteLength - offset)
    if (bytesWritten === 0) throw new Error('Unable to make progress while writing a received file')
    offset += bytesWritten
  }
}

function cleanupTransferState(state: TransferState): Promise<void> {
  if (state.cleanup) return state.cleanup
  state.active = false
  const task = (async () => {
    const errors: unknown[] = []
    const operation = state.activeOperation
    state.activeOperation = null
    if (operation) {
      try {
        await operation
      } catch (error) {
        errors.push(error)
      }
    }
    const batch = state.incomingBatch
    state.incomingBatch = null
    if (batch) {
      try {
        if (batch.current) await batch.current.handle.close()
      } catch (error) {
        errors.push(error)
      }
      try {
        await releaseStagingOwnership(batch)
      } catch (error) {
        errors.push(error)
      }
    }
    if (errors.length === 1) throw errors[0]
    if (errors.length > 1) throw new AggregateError(errors, 'Failed to clean a File Transfer')
  })()
  state.cleanup = task
  pendingTransferCleanups.add(task)
  void task.then(
    () => pendingTransferCleanups.delete(task),
    () => pendingTransferCleanups.delete(task)
  )
  return task
}

function enterAvailable(runtime: SessionRuntime): void {
  appState.setTarget(null)
  appState.transitionSession('settle-available')
  refreshPresenceAnnounce()
  emitState(runtime)
}

function handleChannelClosed(session: SessionOwnership): void {
  if (activeSession !== session) return
  activeSession = null
  void cleanupTransferState(session.transfer).catch((error) =>
    console.error('Failed to clean an interrupted File Transfer', error)
  )

  const connectionLost = !session.intentionalClose
  enterAvailable(session.runtime)
  if (connectionLost) session.runtime.emit('syncer:connection-lost')
}

async function handleApplicationMessage(
  session: SessionOwnership,
  message: TcpApplicationMessage
): Promise<void> {
  const { runtime } = session
  switch (message.type) {
    case 'text':
      runtime.emit('syncer:text-received', { content: message.content })
      return
    case 'command':
      try {
        const result = await runtime.executeCommand(message.content)
        if (!result.ok) {
          if (result.cause) console.error('Failed to execute Command', result.cause)
          runtime.emit(COMMAND_FAILED_CHANNEL, {
            command: message.content,
            reason: result.reason,
            message: result.message
          } satisfies CommandFailedPayload)
        }
      } catch (error) {
        console.error('Failed to execute Command', error)
        runtime.emit(COMMAND_FAILED_CHANNEL, {
          command: message.content,
          reason: 'injection-failed',
          message: '桌面端执行 Command 失败'
        } satisfies CommandFailedPayload)
      }
      return
    case 'ring':
      if (session.findDevice.handle(message)) runtime.emit(FIND_DEVICE_STOPPED_CHANNEL)
      return
  }
}

async function beginFileBatch(state: TransferState, files: readonly FileMetadata[]): Promise<void> {
  assertTransferStateActive(state)
  if (state.incomingBatch) throw new Error('A received File Transfer is already active')
  await retryPendingStagingCleanup()
  const reservation = stagingBudget.reserve(files.reduce((total, file) => total + file.size, 0))
  try {
    state.incomingBatch = {
      directory: await fileStorage().createBatchDirectory(),
      files: [],
      current: null,
      reservation,
      released: false
    }
  } catch (error) {
    reservation.release()
    throw error
  }
}

async function beginFile(state: TransferState, file: FileMetadata): Promise<void> {
  assertTransferStateActive(state)
  const batch = state.incomingBatch
  if (!batch || batch.current) throw new Error('File Transfer begin is out of sequence')
  const staged: StagedFile = {
    ...file,
    path: fileStorage().stagedFilePath(batch.directory)
  }
  batch.current = { ...staged, handle: await open(staged.path, 'wx') }
}

async function receiveFileChunk(
  state: TransferState,
  file: FileMetadata,
  chunk: Uint8Array
): Promise<void> {
  assertTransferStateActive(state)
  const current = state.incomingBatch?.current
  if (!current || current.id !== file.id) throw new Error('File Transfer chunk is out of sequence')
  await writeAll(current.handle, chunk)
}

async function endFile(state: TransferState, file: FileMetadata): Promise<void> {
  assertTransferStateActive(state)
  const batch = state.incomingBatch
  const current = batch?.current
  if (!batch || !current || current.id !== file.id) {
    throw new Error('File Transfer end is out of sequence')
  }
  await current.handle.close()
  batch.files.push({
    id: current.id,
    name: current.name,
    size: current.size,
    mimeType: current.mimeType,
    path: current.path
  })
  batch.current = null
}

async function completeFileBatch(
  state: TransferState,
  files: readonly FileMetadata[]
): Promise<void> {
  assertTransferStateActive(state)
  const batch = state.incomingBatch
  if (!batch || batch.current || batch.files.length !== files.length) {
    throw new Error('File Transfer batch completed with missing files')
  }
  const receiptId = randomUUID()
  receipts.set(receiptId, {
    directory: batch.directory,
    files: batch.files.map((staged) => ({
      staged,
      pendingPublication: null,
      publication: null,
      historyRecorded: false,
      stagingReleased: false
    })),
    reservation: batch.reservation,
    released: batch.released,
    operation: null
  })
  state.incomingBatch = null
  const payload: ReceivedFileBatch = {
    receiptId,
    content: batch.files.map(({ name, size }) => ({ name, size })),
    historyPending: []
  }
  state.runtime.emit('syncer:file-received', payload)
}

export function attachSessionSocket(
  socket: FramedSocket,
  device: AvailableDevice,
  runtime: SessionRuntime = productionSessionRuntime
): void {
  if (shuttingDown) {
    socket.destroy()
    throw new Error('Session storage is shutting down')
  }
  const transfer = createTransferState(runtime)
  const nextSession: SessionOwnership = {
    channel: null,
    transfer,
    runtime,
    intentionalClose: false,
    findDevice: new FindDeviceCoordinator()
  }
  try {
    nextSession.channel = new SessionChannel(socket, {
      onMessage: (message) =>
        runOwnedOperation(transfer, () => handleApplicationMessage(nextSession, message)),
      onFileOffer: (files) => runOwnedOperation(transfer, () => beginFileBatch(transfer, files)),
      onFileBegin: (file) => runOwnedOperation(transfer, () => beginFile(transfer, file)),
      onFileChunk: (file, chunk) =>
        runOwnedOperation(transfer, () => receiveFileChunk(transfer, file, chunk)),
      onFileEnd: (file) => runOwnedOperation(transfer, () => endFile(transfer, file)),
      onFileBatchEnd: (files) =>
        runOwnedOperation(transfer, () => completeFileBatch(transfer, files)),
      onRemoteDisconnect: () => {
        assertTransferStateActive(transfer)
        nextSession.intentionalClose = true
      },
      onClose: () => {
        handleChannelClosed(nextSession)
      },
      onError: (error) => {
        console.error('Session error', error)
      }
    })
  } catch (error) {
    socket.destroy()
    throw error
  }

  const previous = activeSession
  activeSession = nextSession
  appState.setTarget(device)
  appState.transitionSession('attach-session')
  refreshPresenceAnnounce()
  emitState(runtime)

  if (previous) {
    previous.channel?.destroy()
    void cleanupTransferState(previous.transfer).catch((error) =>
      console.error('Failed to clean replaced Session staging', error)
    )
  }
}

function activeChannel(): SessionChannel {
  const active = activeSession?.channel
  if (!active || active.closed || appState.status !== 'connected') {
    throw new Error('No active Session')
  }
  return active
}

export async function sendText(content: string): Promise<void> {
  await activeChannel().send({ type: 'text', content })
}

export async function sendCommand(command: CommandKey): Promise<void> {
  await activeChannel().send({ type: 'command', content: command })
}

export async function setFindDeviceActive(active: boolean): Promise<void> {
  const session = activeSession
  const activeSessionChannel = activeChannel()
  if (!session || session.channel !== activeSessionChannel) throw new Error('No active Session')

  await session.findDevice.setActive(active, async (message) => {
    if (
      activeSession !== session ||
      session.channel !== activeSessionChannel ||
      activeSessionChannel.closed ||
      appState.status !== 'connected'
    ) {
      throw new Error('No active Session')
    }
    await activeSessionChannel.send(message)
  })
}

async function* readFileChunks(path: string): AsyncIterable<Uint8Array> {
  for await (const chunk of createReadStream(path, { highWaterMark: FILE_CHUNK_BYTES })) {
    if (!(chunk instanceof Uint8Array)) throw new Error('File stream produced a non-binary chunk')
    yield chunk
  }
}

export async function sendFiles(files: readonly SelectedFile[]): Promise<void> {
  const outgoing: OutgoingFile[] = []
  for (const file of files) {
    const name = fileNameSchema.parse(file.name)
    if (!file.path) throw new Error(`No filesystem path is available for ${name}`)
    const details = await stat(file.path)
    if (!details.isFile()) throw new Error(`${name} is not a regular file`)
    outgoing.push({
      id: randomUUID(),
      name,
      size: details.size,
      mimeType: file.mimeType,
      chunks: () => readFileChunks(file.path)
    })
  }
  await activeChannel().sendFileBatch(outgoing)
}

export async function disconnectSession(notifyPeer = true): Promise<void> {
  const session = activeSession
  activeSession = null
  try {
    const active = session?.channel
    if (active) {
      if (notifyPeer && !active.closed) await active.disconnect()
      else active.destroy()
    }
  } finally {
    try {
      if (session) await cleanupTransferState(session.transfer)
    } finally {
      if (!shuttingDown) enterAvailable(session?.runtime ?? productionSessionRuntime)
    }
  }
}

async function commitPendingPublication(file: ReceiptFile): Promise<void> {
  const pending = file.pendingPublication
  if (!pending) return
  let name: string
  try {
    name = await fileStorage().commitPublication(pending.publication)
  } catch (error) {
    if (await fileStorage().abandonPublication(pending.publication)) {
      file.pendingPublication = null
    }
    throw error
  }
  file.publication = {
    name,
    path: pending.publication.directory,
    time: pending.time
  }
  file.pendingPublication = null
}

async function completePendingPublications(receipt: FileReceipt): Promise<void> {
  for (const file of receipt.files) await commitPendingPublication(file)
}

function runReceiptOperation<T>(receipt: FileReceipt, operation: () => Promise<T>): Promise<T> {
  if (shuttingDown) throw new Error('Session storage is shutting down')
  if (receipt.operation) throw new Error('File Transfer receipt already has an active operation')

  const task = Promise.resolve().then(operation)
  receipt.operation = task
  activeReceiptOperations.add(task)
  const release = (): void => {
    activeReceiptOperations.delete(task)
    if (receipt.operation === task) receipt.operation = null
  }
  void task.then(release, release)
  return task
}

export function saveReceivedFiles(receiptId: string): Promise<SaveFilesResult | null> {
  const receipt = receipts.get(receiptId)
  if (!receipt) throw new Error('File Transfer receipt does not exist')
  return runReceiptOperation(receipt, () => saveReceipt(receiptId, receipt))
}

async function saveReceipt(
  receiptId: string,
  receipt: FileReceipt
): Promise<SaveFilesResult | null> {
  try {
    await completePendingPublications(receipt)
    recordPendingHistory(receipt)
  } catch (error) {
    const progress = receiptProgress(receipt)
    if (progress.publishedCount === 0) throw error
    return incompleteSaveResult(progress, progress.paths[0] ?? '')
  }
  await cleanupPublishedStaging(receipt)

  if (receipt.files.every((file) => file.publication && file.historyRecorded)) {
    const progress = receiptProgress(receipt)
    const path = progress.paths[0] ?? ''
    await finalizeReceipt(receiptId, receipt)
    return completeSaveResult(progress, path)
  }

  const window = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
  const options: Electron.OpenDialogOptions = {
    title: '保存文件',
    defaultPath: getStorage(STORAGE_KEYS.FILE_PATH) ?? undefined,
    properties: ['openDirectory']
  }
  const result = window
    ? await dialog.showOpenDialog(window, options)
    : await dialog.showOpenDialog(options)
  if (result.canceled || !result.filePaths[0] || shuttingDown) return null

  const directory = result.filePaths[0]
  setStorage(STORAGE_KEYS.FILE_PATH, directory)

  let failure: unknown = null
  for (const file of receipt.files) {
    if (file.publication) continue
    try {
      if (!file.pendingPublication) {
        file.pendingPublication = {
          publication: await fileStorage().preparePublication(
            file.staged.path,
            directory,
            file.staged.name
          ),
          time: Date.now()
        }
      }
      await commitPendingPublication(file)
      recordPendingHistory(receipt)
      await cleanupPublishedStaging(receipt)
    } catch (error) {
      failure = error
      break
    }
  }

  const progress = receiptProgress(receipt)
  const complete =
    failure == null && progress.remaining.length === 0 && progress.historyPending.length === 0
  if (complete) {
    await finalizeReceipt(receiptId, receipt)
    return completeSaveResult(progress, directory)
  }
  if (progress.publishedCount === 0) throw failure
  return incompleteSaveResult(progress, directory)
}

export function discardReceivedFiles(receiptId: string): Promise<void> {
  const receipt = receipts.get(receiptId)
  if (!receipt) return Promise.resolve()
  return runReceiptOperation(receipt, async () => {
    await completePendingPublications(receipt)
    recordPendingHistory(receipt)
    await cleanupPublishedStaging(receipt)
    await finalizeReceipt(receiptId, receipt)
  })
}

export async function getPendingReceivedFiles(): Promise<ReceivedFileBatch[]> {
  await Promise.allSettled([...activeReceiptOperations])
  return [...receipts].map(([receiptId, receipt]) => receiptProjection(receiptId, receipt))
}

export async function shutdownSession(): Promise<void> {
  shuttingDown = true
  const errors: unknown[] = []
  try {
    await disconnectSession(false)
  } catch (error) {
    errors.push(error)
  }

  const receiptOperations = await Promise.allSettled([...activeReceiptOperations])
  for (const result of receiptOperations) {
    if (result.status === 'rejected') errors.push(result.reason)
  }

  const transferCleanups = await Promise.allSettled([...pendingTransferCleanups])
  for (const result of transferCleanups) {
    if (result.status === 'rejected') errors.push(result.reason)
  }

  for (const [receiptId, receipt] of receipts) {
    try {
      await completePendingPublications(receipt)
      recordPendingHistory(receipt)
      await cleanupPublishedStaging(receipt)
      await finalizeReceipt(receiptId, receipt)
    } catch (error) {
      errors.push(error)
    }
  }

  let rootRemoved = false
  if (receipts.size === 0) {
    try {
      await fileStorage().reset()
      rootRemoved = true
    } catch (error) {
      errors.push(error)
    }
  }

  if (rootRemoved) {
    for (const ownership of [...pendingStagingCleanup]) {
      ownership.reservation.release()
      ownership.released = true
      pendingStagingCleanup.delete(ownership)
    }
  }

  if (errors.length === 1) throw errors[0]
  if (errors.length > 1) throw new AggregateError(errors, 'Failed to shut down Session storage')
}

function recordPendingHistory(receipt: FileReceipt): void {
  const pending = receipt.files.filter(
    (file): file is ReceiptFile & { publication: ReceiveHistoryItem } =>
      file.publication != null && !file.historyRecorded
  )
  if (pending.length === 0) return

  const receiveHistory = getStorage(STORAGE_KEYS.RECEIVE_HISTORY) ?? []
  setStorage(STORAGE_KEYS.RECEIVE_HISTORY, [
    ...pending.map((file) => file.publication).reverse(),
    ...receiveHistory
  ])
  pending.forEach((file) => {
    file.historyRecorded = true
  })
}

function publicationPaths(receipt: FileReceipt): string[] {
  return [
    ...new Set(receipt.files.flatMap((file) => (file.publication ? [file.publication.path] : [])))
  ]
}

function receiptProgress(receipt: FileReceipt): {
  publishedCount: number
  remaining: ReceivedFileSummary[]
  historyPending: ReceivedFileSummary[]
  paths: string[]
} {
  const publishedCount = receipt.files.filter((file) => file.publication).length
  return {
    publishedCount,
    remaining: receipt.files.filter((file) => !file.publication).map(fileSummary),
    historyPending: receipt.files
      .filter((file) => file.publication != null && !file.historyRecorded)
      .map(fileSummary),
    paths: publicationPaths(receipt)
  }
}

function fileSummary(file: ReceiptFile): ReceivedFileSummary {
  return { name: file.staged.name, size: file.staged.size }
}

function receiptProjection(receiptId: string, receipt: FileReceipt): ReceivedFileBatch {
  const progress = receiptProgress(receipt)
  return {
    receiptId,
    content: progress.remaining,
    historyPending: progress.historyPending
  }
}

function completeSaveResult(
  progress: ReturnType<typeof receiptProgress>,
  path: string
): SaveFilesResult {
  return {
    count: progress.publishedCount,
    path,
    paths: progress.paths,
    complete: true,
    remainingCount: 0,
    remaining: [],
    historyPendingCount: 0,
    historyPending: []
  }
}

function incompleteSaveResult(
  progress: ReturnType<typeof receiptProgress>,
  path: string
): SaveFilesResult {
  return {
    count: progress.publishedCount,
    path,
    paths: progress.paths,
    complete: false,
    remainingCount: progress.remaining.length,
    remaining: progress.remaining,
    historyPendingCount: progress.historyPending.length,
    historyPending: progress.historyPending
  }
}

async function cleanupPublishedStaging(receipt: FileReceipt): Promise<void> {
  for (const file of receipt.files) {
    if (receipt.released || !file.publication || !file.historyRecorded || file.stagingReleased) {
      continue
    }
    try {
      await rm(file.staged.path, { force: true })
      receipt.reservation.releaseBytes(file.staged.size)
      file.stagingReleased = true
    } catch (error) {
      console.error('Failed to remove a published File Transfer staging file', error)
    }
  }
}

async function finalizeReceipt(receiptId: string, receipt: FileReceipt): Promise<void> {
  if (receipts.get(receiptId) !== receipt) return
  receipts.delete(receiptId)
  try {
    await releaseStagingOwnership(receipt)
  } catch (error) {
    console.error('Failed to remove a completed File Transfer receipt', error)
  }
}
