import assert from 'node:assert/strict'
import test from 'node:test'

import { RecentKeyLimiter, TokenBucket } from '@syncer/protocol'

test('TokenBucket bounds bursts and refills at the declared rate', () => {
  const bucket = new TokenBucket(2, 2, 1000)
  assert.equal(bucket.take(1000), true)
  assert.equal(bucket.take(1000), true)
  assert.equal(bucket.take(1000), false)
  assert.equal(bucket.take(1500), true)
  assert.equal(bucket.take(1500), false)
})

test('RecentKeyLimiter deduplicates keys with bounded memory', () => {
  const limiter = new RecentKeyLimiter(500, 2)
  assert.equal(limiter.take('a', 1000), true)
  assert.equal(limiter.take('a', 1200), false)
  assert.equal(limiter.take('b', 1200), true)
  assert.equal(limiter.take('c', 1200), true)
  assert.equal(limiter.size, 2)
  assert.equal(limiter.take('a', 1300), true)
})
