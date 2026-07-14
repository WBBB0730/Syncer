import type { SessionStatus } from './types.js'

export type SessionLifecycleEvent =
  | 'start-connection'
  | 'attach-session'
  | 'settle-available'

const transitions: Readonly<
  Record<SessionStatus, Readonly<Partial<Record<SessionLifecycleEvent, SessionStatus>>>>
> = {
  available: {
    'start-connection': 'connecting',
    'attach-session': 'connected',
    'settle-available': 'available'
  },
  connecting: {
    'attach-session': 'connected',
    'settle-available': 'available'
  },
  connected: {
    'settle-available': 'available'
  }
}

export function transitionSessionStatus(
  status: SessionStatus,
  event: SessionLifecycleEvent
): SessionStatus {
  const next = transitions[status][event]
  if (!next) throw new Error(`Invalid Session lifecycle transition: ${status} + ${event}`)
  return next
}

export interface RestartableRuntimeOperations {
  start(): Promise<void>
  stop(): Promise<void>
}

export interface RuntimeRecoveryOptions {
  signal?: AbortSignal
  initialRetryDelayMs?: number
  maximumRetryDelayMs?: number
  onError?: (error: unknown, nextRetryDelayMs: number) => void
}

const DEFAULT_RUNTIME_RETRY_DELAY_MS = 500
const DEFAULT_RUNTIME_MAXIMUM_RETRY_DELAY_MS = 30_000

export class RestartableRuntime {
  private desired = false
  private running = false
  private revision = 0
  private appliedRevision = 0
  private transition: Promise<void> | null = null
  private recoveryToken = 0

  constructor(private readonly operations: RestartableRuntimeOperations) {}

  ensureRunning(): Promise<void> {
    if (this.running) return Promise.resolve()
    this.recoveryToken += 1
    if (!this.desired || !this.transition) this.revision += 1
    this.desired = true
    return this.waitForRevision(this.revision)
  }

  restart(): Promise<void> {
    if (!this.desired) return Promise.resolve()
    this.recoveryToken += 1
    this.running = false
    this.revision += 1
    return this.waitForRevision(this.revision)
  }

  async recover(options: RuntimeRecoveryOptions = {}): Promise<void> {
    if (!this.desired || options.signal?.aborted) return
    const initialRetryDelayMs =
      options.initialRetryDelayMs ?? DEFAULT_RUNTIME_RETRY_DELAY_MS
    const maximumRetryDelayMs =
      options.maximumRetryDelayMs ?? DEFAULT_RUNTIME_MAXIMUM_RETRY_DELAY_MS
    assertRetryDelay(initialRetryDelayMs, 'initial')
    assertRetryDelay(maximumRetryDelayMs, 'maximum')
    if (maximumRetryDelayMs < initialRetryDelayMs) {
      throw new Error('Maximum runtime retry delay must not be shorter than the initial delay')
    }

    const recoveryToken = ++this.recoveryToken
    let retryDelayMs = initialRetryDelayMs
    this.running = false
    this.desired = false
    this.revision += 1

    while (this.isActiveRecovery(recoveryToken, options.signal)) {
      try {
        await this.waitForRevision(this.revision)
        break
      } catch (error) {
        retryDelayMs = Math.min(retryDelayMs * 2, maximumRetryDelayMs)
        options.onError?.(error, retryDelayMs)
        if (!(await waitForRetryDelay(retryDelayMs, options.signal))) return
        if (!this.isActiveRecovery(recoveryToken, options.signal)) return
        this.revision += 1
      }
    }

    while (this.isActiveRecovery(recoveryToken, options.signal)) {
      if (!(await waitForRetryDelay(retryDelayMs, options.signal))) return
      if (!this.isActiveRecovery(recoveryToken, options.signal)) return

      this.desired = true
      this.revision += 1
      try {
        await this.waitForRevision(this.revision)
        if (this.running) return
      } catch (error) {
        retryDelayMs = Math.min(retryDelayMs * 2, maximumRetryDelayMs)
        options.onError?.(error, retryDelayMs)
      }
    }
  }

  ensureStopped(): Promise<void> {
    this.recoveryToken += 1
    if (!this.desired && !this.running && !this.transition) return Promise.resolve()
    this.desired = false
    this.running = false
    this.revision += 1
    return this.waitForRevision(this.revision)
  }

  get isRunning(): boolean {
    return this.running
  }

  private isActiveRecovery(token: number, signal?: AbortSignal): boolean {
    return this.recoveryToken === token && !signal?.aborted
  }

  private waitForRevision(revision: number): Promise<void> {
    return this.schedule().then(() => {
      if (this.appliedRevision >= revision) return
      return this.waitForRevision(revision)
    })
  }

  private schedule(): Promise<void> {
    if (this.transition) return this.transition

    const operation = Promise.resolve().then(() => this.reconcile())
    this.transition = operation
    void operation.then(
      () => this.releaseTransition(operation),
      () => this.releaseTransition(operation)
    )
    return operation
  }

  private releaseTransition(operation: Promise<void>): void {
    if (this.transition === operation) this.transition = null
  }

  private async reconcile(): Promise<void> {
    let clean = false

    while (this.appliedRevision < this.revision) {
      const revision = this.revision
      this.running = false

      if (!clean) {
        try {
          await this.operations.stop()
          clean = true
        } catch (error) {
          this.appliedRevision = revision
          throw error
        }
      }

      if (revision !== this.revision) continue
      if (!this.desired) {
        this.appliedRevision = revision
        return
      }

      try {
        await this.operations.start()
        clean = false
      } catch (error) {
        let cleanupError: unknown = null
        try {
          await this.operations.stop()
          clean = true
        } catch (nextError) {
          cleanupError = nextError
        }
        if (cleanupError) {
          this.appliedRevision = revision
          throw new AggregateError([error, cleanupError], 'Runtime startup and cleanup failed')
        }
        if (revision !== this.revision) continue
        this.appliedRevision = revision
        throw error
      }

      if (revision !== this.revision || !this.desired) {
        try {
          await this.operations.stop()
          clean = true
        } catch (error) {
          this.appliedRevision = revision
          throw error
        }
        continue
      }

      this.running = true
      this.appliedRevision = revision
    }
  }
}

function assertRetryDelay(value: number, label: string): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${label} runtime retry delay must be a positive finite number`)
  }
}

function waitForRetryDelay(delayMs: number, signal?: AbortSignal): Promise<boolean> {
  if (signal?.aborted) return Promise.resolve(false)
  return new Promise((resolve) => {
    const finish = (completed: boolean): void => {
      clearTimeout(timer)
      signal?.removeEventListener('abort', onAbort)
      resolve(completed)
    }
    const onAbort = (): void => finish(false)
    const timer = setTimeout(() => finish(true), delayMs)
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}
