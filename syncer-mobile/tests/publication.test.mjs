import assert from 'node:assert/strict'
import test from 'node:test'

import { PublicationLedger } from '../src/service/publication.ts'
import { publishRemainingFiles } from '../src/service/sequentialPublication.ts'

test('partial publication retains exact retry, cleanup, and history ownership', () => {
  const ledger = new PublicationLedger()
  const first = { sourceUri: 'file:///first.part', size: 5 }
  const second = { sourceUri: 'file:///second.part', size: 7 }
  const history = { name: 'first.txt' }
  ledger.addStaged(first)
  ledger.addStaged(second)

  ledger.recordPublication([{ sourceUri: first.sourceUri }], [history], false)
  assert.deepEqual(ledger.remaining, [second])
  assert.deepEqual(ledger.pendingCleanup, [first])
  assert.deepEqual(ledger.pendingHistory, [history])

  assert.equal(ledger.acknowledgeCleanup(first.sourceUri), first)
  ledger.acknowledgeHistory([history])
  assert.deepEqual(ledger.pendingCleanup, [])
  assert.deepEqual(ledger.pendingHistory, [])
})

test('publication rejects foreign, duplicate, and inaccurate completion results', () => {
  const staged = { sourceUri: 'file:///staged.part', size: 3 }

  for (const publish of [
    (ledger) => ledger.recordPublication([{ sourceUri: 'file:///foreign.part' }], [{}], false),
    (ledger) =>
      ledger.recordPublication(
        [{ sourceUri: staged.sourceUri }, { sourceUri: staged.sourceUri }],
        [{}, {}],
        true
      ),
    (ledger) => ledger.recordPublication([{ sourceUri: staged.sourceUri }], [{}], false)
  ]) {
    const ledger = new PublicationLedger()
    ledger.addStaged(staged)
    assert.throws(() => publish(ledger), /Native publication/)
    assert.deepEqual(ledger.remaining, [staged])
  }
})

test('failed history persistence keeps the exact acknowledgement pending for retry', () => {
  const ledger = new PublicationLedger()
  const staged = { sourceUri: 'file:///staged.part', size: 3 }
  const history = { name: 'staged.txt' }
  ledger.addStaged(staged)
  ledger.recordPublication([{ sourceUri: staged.sourceUri }], [history], true)

  const attempt = [...ledger.pendingHistory]
  assert.deepEqual(ledger.pendingHistory, [history])
  ledger.acknowledgeHistory(attempt)
  assert.deepEqual(ledger.pendingHistory, [])
})

test('single-file publication records each success before attempting the next file', async () => {
  const ledger = new PublicationLedger()
  const first = { sourceUri: 'file:///first.part', size: 5 }
  const second = { sourceUri: 'file:///second.part', size: 7 }
  ledger.addStaged(first)
  ledger.addStaged(second)
  const attempts = []
  let failSecond = true

  const publish = (staged, complete) => {
    attempts.push(staged.sourceUri)
    if (staged === second && failSecond) throw new Error('second failed')
    ledger.recordPublication(
      [{ sourceUri: staged.sourceUri }],
      [{ name: staged.sourceUri }],
      complete
    )
  }

  await assert.rejects(
    publishRemainingFiles(() => ledger.remaining, async (staged, complete) =>
      publish(staged, complete)
    ),
    /second failed/
  )
  assert.deepEqual(ledger.remaining, [second])
  assert.deepEqual(attempts, [first.sourceUri, second.sourceUri])

  failSecond = false
  await publishRemainingFiles(() => ledger.remaining, async (staged, complete) =>
    publish(staged, complete)
  )
  assert.deepEqual(ledger.remaining, [])
  assert.deepEqual(attempts, [first.sourceUri, second.sourceUri, second.sourceUri])
})
