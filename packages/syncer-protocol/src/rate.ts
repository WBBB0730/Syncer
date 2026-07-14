export class TokenBucket {
  private tokens: number
  private updatedAt: number

  constructor(
    private readonly capacity: number,
    private readonly refillPerSecond: number,
    now = Date.now()
  ) {
    if (capacity <= 0 || refillPerSecond <= 0) {
      throw new Error('Token bucket limits must be positive')
    }
    this.tokens = capacity
    this.updatedAt = now
  }

  take(now = Date.now()): boolean {
    const elapsed = Math.max(0, now - this.updatedAt)
    this.tokens = Math.min(
      this.capacity,
      this.tokens + (elapsed * this.refillPerSecond) / 1000
    )
    this.updatedAt = Math.max(this.updatedAt, now)
    if (this.tokens < 1) return false
    this.tokens -= 1
    return true
  }
}

export class RecentKeyLimiter {
  private readonly seen = new Map<string, number>()

  constructor(
    private readonly intervalMs: number,
    private readonly capacity: number
  ) {
    if (intervalMs <= 0 || !Number.isSafeInteger(capacity) || capacity <= 0) {
      throw new Error('Recent key limits must be positive')
    }
  }

  take(key: string, now = Date.now()): boolean {
    const previous = this.seen.get(key)
    if (previous !== undefined && now - previous < this.intervalMs) return false
    if (previous !== undefined) this.seen.delete(key)
    while (this.seen.size >= this.capacity) {
      const oldest = this.seen.keys().next().value as string | undefined
      if (oldest === undefined) break
      this.seen.delete(oldest)
    }
    this.seen.set(key, now)
    return true
  }

  get size(): number {
    return this.seen.size
  }
}
