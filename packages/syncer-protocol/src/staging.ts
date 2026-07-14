import { MAX_STAGED_FILE_BATCHES, MAX_STAGED_FILE_BYTES } from './constants.js'

export class StagingBudget {
  private batchCount = 0
  private byteCount = 0

  constructor(
    private readonly maxBatches = MAX_STAGED_FILE_BATCHES,
    private readonly maxBytes = MAX_STAGED_FILE_BYTES
  ) {}

  reserve(bytes: number): StagingReservation {
    if (!Number.isSafeInteger(bytes) || bytes < 0) {
      throw new Error('Staged File Transfer size must be a non-negative safe integer')
    }
    if (this.batchCount >= this.maxBatches || this.byteCount + bytes > this.maxBytes) {
      throw new Error('File Transfer staging limit exceeded')
    }

    this.batchCount += 1
    this.byteCount += bytes
    return new StagingReservation(this, bytes)
  }

  releaseBatch(bytes: number): void {
    this.batchCount -= 1
    this.byteCount -= bytes
  }

  releaseBytes(bytes: number): void {
    this.byteCount -= bytes
  }

  snapshot(): Readonly<{ batches: number; bytes: number }> {
    return { batches: this.batchCount, bytes: this.byteCount }
  }
}

export class StagingReservation {
  private remainingBytes: number
  private active = true

  constructor(
    private readonly budget: StagingBudget,
    bytes: number
  ) {
    this.remainingBytes = bytes
  }

  releaseBytes(bytes: number): void {
    if (!this.active || !Number.isSafeInteger(bytes) || bytes < 0 || bytes > this.remainingBytes) {
      throw new Error('Invalid staged File Transfer release')
    }
    this.remainingBytes -= bytes
    this.budget.releaseBytes(bytes)
  }

  release(): void {
    if (!this.active) return
    this.active = false
    this.budget.releaseBatch(this.remainingBytes)
    this.remainingBytes = 0
  }

  get bytes(): number {
    return this.remainingBytes
  }
}
