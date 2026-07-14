import { randomUUID } from 'crypto'
import { mkdir, mkdtemp, open, rm, type FileHandle } from 'fs/promises'
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'path'
import { collisionFileName } from '@syncer/protocol'
import { z } from 'zod'
import { moveNoReplace } from '../utils/atomicMove'
import { AtomicJsonStorage } from '../utils/atomicStorage'

const COPY_BUFFER_BYTES = 64 * 1024
const PUBLICATION_JOURNAL_FILE = 'publication-journal.json'
const publicationTemporaryNamePattern =
  /^\.syncer-publication-[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.partial$/iu

const publicationJournalSchema = z
  .object({
    entries: z
      .array(
        z
          .object({
            temporaryPath: z.string().min(1),
            directory: z.string().min(1)
          })
          .strict()
      )
      .default([])
  })
  .strict()

type PublicationJournal = z.infer<typeof publicationJournalSchema>

export interface PendingFilePublication {
  readonly directory: string
}

export interface ReceivedFileStorageOptions {
  readonly journalPath?: string
}

interface OwnedPendingFilePublication extends PendingFilePublication {
  readonly requestedName: string
  readonly temporaryPath: string
  publishedName: string | null
}

export class ReceivedFileStorage {
  readonly root: string
  private readonly pendingPublications = new Map<
    PendingFilePublication,
    OwnedPendingFilePublication
  >()
  private readonly publicationJournal: AtomicJsonStorage<PublicationJournal>
  private readonly journalEntries = new Map<string, PublicationJournal['entries'][number]>()
  private journalLoaded = false
  private publicationTail = Promise.resolve()

  constructor(root: string, options: ReceivedFileStorageOptions = {}) {
    this.root = resolve(root)
    this.publicationJournal = new AtomicJsonStorage(
      resolve(options.journalPath ?? join(this.root, PUBLICATION_JOURNAL_FILE)),
      publicationJournalSchema
    )
  }

  reset(): Promise<void> {
    return this.runPublicationOperation(async () => {
      if (this.pendingPublications.size > 0) {
        throw new Error('Received file publications are still awaiting durable commit')
      }
      await this.retryPublicationCleanupOwned()
      await this.remove(this.root, true)
      this.journalEntries.clear()
    })
  }

  async createBatchDirectory(): Promise<string> {
    await mkdir(this.root, { recursive: true })
    return mkdtemp(join(this.root, 'transfer-'))
  }

  stagedFilePath(directory: string): string {
    this.assertOwnedPath(directory)
    const path = join(directory, randomUUID())
    this.assertOwnedPath(path)
    return path
  }

  async remove(path: string, allowRoot = false): Promise<void> {
    this.assertOwnedPath(path, allowRoot)
    await rm(path, { recursive: true, force: true })
  }

  preparePublication(
    source: string,
    directory: string,
    originalName: string
  ): Promise<PendingFilePublication> {
    return this.runPublicationOperation(async () => {
      this.assertOwnedPath(source)
      await this.retryPublicationCleanupOwned()
      const targetDirectory = resolve(directory)
      this.publicationDestination(targetDirectory, originalName, 0)

      while (true) {
        const temporaryPath = resolve(
          targetDirectory,
          `.syncer-publication-${randomUUID()}.partial`
        )
        this.recordPublicationTemporary(temporaryPath, targetDirectory)

        let handle: FileHandle | null = null
        try {
          handle = await open(temporaryPath, 'wx')
        } catch (error) {
          const errors: unknown[] = [error]
          try {
            this.forgetPublicationTemporary(temporaryPath)
          } catch (journalError) {
            errors.push(journalError)
          }
          if (isNodeError(error) && error.code === 'EEXIST' && errors.length === 1) continue
          if (errors.length === 1) throw error
          throw new AggregateError(errors, 'Received file reservation and journal cleanup failed')
        }

        try {
          await copyIntoFile(source, handle)
          await handle.sync()
          await handle.close()
          handle = null
        } catch (error) {
          const errors: unknown[] = [error]
          if (handle) {
            try {
              await handle.close()
            } catch (closeError) {
              errors.push(closeError)
            }
          }
          try {
            await this.cleanPublicationOwnership(temporaryPath)
          } catch (cleanupError) {
            errors.push(cleanupError)
          }
          if (errors.length === 1) throw error
          throw new AggregateError(errors, 'Received file copy and cleanup failed')
        }

        const publication: OwnedPendingFilePublication = {
          directory: targetDirectory,
          requestedName: originalName,
          temporaryPath,
          publishedName: null
        }
        this.pendingPublications.set(publication, publication)
        return publication
      }
    })
  }

  commitPublication(publication: PendingFilePublication): Promise<string> {
    return this.runPublicationOperation(async () => {
      const owned = this.pendingPublications.get(publication)
      if (!owned) {
        throw new Error('Received file publication is not owned by this storage instance')
      }

      if (!owned.publishedName) {
        for (let collisionIndex = 0; ; collisionIndex += 1) {
          const { name, path } = this.publicationDestination(
            owned.directory,
            owned.requestedName,
            collisionIndex
          )
          if (!moveNoReplace(owned.temporaryPath, path)) continue
          owned.publishedName = name
          break
        }
      }
      const publishedName = owned.publishedName
      if (!publishedName) throw new Error('Received file publication has no destination name')
      this.pendingPublications.delete(publication)
      try {
        this.forgetPublicationTemporary(owned.temporaryPath)
      } catch {
        // The exact path remains journaled and blocks later publication until cleanup succeeds.
      }
      return publishedName
    })
  }

  abandonPublication(publication: PendingFilePublication): Promise<boolean> {
    return this.runPublicationOperation(async () => {
      const owned = this.pendingPublications.get(publication)
      if (!owned || owned.publishedName) return false

      this.pendingPublications.delete(publication)
      try {
        await this.cleanActivePublication(owned)
      } catch {
        // The exact path remains journaled and blocks later publication until cleanup succeeds.
      }
      return true
    })
  }

  retryPublicationCleanup(): Promise<void> {
    return this.runPublicationOperation(() => this.retryPublicationCleanupOwned())
  }

  private async retryPublicationCleanupOwned(): Promise<void> {
    this.loadPublicationJournal()
    const activePaths = new Set(
      [...this.pendingPublications.values()].map((publication) => publication.temporaryPath)
    )
    const errors: unknown[] = []
    for (const [temporaryPath, entry] of [...this.journalEntries]) {
      if (activePaths.has(temporaryPath)) continue
      try {
        await this.cleanInterruptedPublication(entry)
      } catch (error) {
        errors.push(error)
      }
    }

    if (errors.length === 1) throw errors[0]
    if (errors.length > 1) {
      throw new AggregateError(errors, 'Failed to clean received file publications')
    }
  }

  private runPublicationOperation<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.publicationTail.then(operation)
    this.publicationTail = result.then(
      () => undefined,
      () => undefined
    )
    return result
  }

  private loadPublicationJournal(): void {
    if (this.journalLoaded) return
    const entries = this.publicationJournal.read().entries
    const validated = new Map<string, PublicationJournal['entries'][number]>()
    for (const entry of entries) {
      const directory = resolve(entry.directory)
      const temporaryPath = resolve(entry.temporaryPath)
      if (
        !isAbsolute(entry.directory) ||
        !isAbsolute(entry.temporaryPath) ||
        dirname(temporaryPath) !== directory ||
        !publicationTemporaryNamePattern.test(basename(temporaryPath)) ||
        validated.has(temporaryPath)
      ) {
        throw new Error('Received file publication journal contains an invalid path')
      }
      validated.set(temporaryPath, { temporaryPath, directory })
    }
    this.journalEntries.clear()
    for (const [temporaryPath, entry] of validated) {
      this.journalEntries.set(temporaryPath, entry)
    }
    this.journalLoaded = true
  }

  private recordPublicationTemporary(temporaryPath: string, directory: string): void {
    this.loadPublicationJournal()
    if (this.journalEntries.has(temporaryPath)) {
      throw new Error('Received file publication temporary path is already owned')
    }
    const entry = { temporaryPath, directory }
    const next = new Map(this.journalEntries).set(temporaryPath, entry)
    this.writePublicationJournal(next)
    this.journalEntries.set(temporaryPath, entry)
  }

  private forgetPublicationTemporary(temporaryPath: string): void {
    this.loadPublicationJournal()
    if (!this.journalEntries.has(temporaryPath)) return
    const next = new Map(this.journalEntries)
    next.delete(temporaryPath)
    this.writePublicationJournal(next)
    this.journalEntries.delete(temporaryPath)
  }

  private writePublicationJournal(
    entries: ReadonlyMap<string, PublicationJournal['entries'][number]>
  ): void {
    this.publicationJournal.write({
      entries: [...entries.values()]
    })
  }

  private cleanActivePublication(publication: OwnedPendingFilePublication): Promise<void> {
    return this.cleanPublicationOwnership(publication.temporaryPath)
  }

  private async cleanPublicationOwnership(temporaryPath: string): Promise<void> {
    await rm(temporaryPath, { force: true })
    this.forgetPublicationTemporary(temporaryPath)
  }

  private async cleanInterruptedPublication(
    entry: PublicationJournal['entries'][number]
  ): Promise<void> {
    await rm(entry.temporaryPath, { force: true })
    this.forgetPublicationTemporary(entry.temporaryPath)
  }

  private assertOwnedPath(path: string, allowRoot = false): void {
    const target = resolve(path)
    const child = relative(this.root, target)
    if (
      (allowRoot && child === '') ||
      (child !== '' && !child.startsWith(`..${sep}`) && child !== '..' && !isAbsolute(child))
    ) {
      return
    }
    throw new Error('Path is outside the File Transfer staging directory')
  }

  private publicationDestination(
    directory: string,
    requestedName: string,
    collisionIndex: number
  ): { name: string; path: string } {
    const name =
      collisionIndex === 0 ? requestedName : collisionFileName(requestedName, collisionIndex)
    const path = resolve(directory, name)
    if (dirname(path) !== directory) {
      throw new Error('Received file name escapes the save directory')
    }
    return { name, path }
  }
}

async function copyIntoFile(source: string, destination: FileHandle): Promise<void> {
  const sourceFile = await open(source, 'r')
  const buffer = Buffer.allocUnsafe(COPY_BUFFER_BYTES)
  try {
    while (true) {
      const { bytesRead } = await sourceFile.read(buffer, 0, buffer.byteLength)
      if (bytesRead === 0) return

      let offset = 0
      while (offset < bytesRead) {
        const { bytesWritten } = await destination.write(buffer, offset, bytesRead - offset)
        if (bytesWritten === 0) throw new Error('Unable to make progress while copying a file')
        offset += bytesWritten
      }
    }
  } finally {
    await sourceFile.close()
  }
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error
}
