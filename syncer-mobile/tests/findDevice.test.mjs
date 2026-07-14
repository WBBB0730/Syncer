import assert from 'node:assert/strict'
import test from 'node:test'

import {
  FIND_DEVICE_NOTIFICATION_KIND,
  FIND_DEVICE_STOP_ACTION,
  findDeviceNotificationIdentifier,
  getFindDeviceStopToken,
  setVerifiedVolume,
  startPreferredFindDeviceFeedback
} from '../src/service/findDevice.ts'

function notificationResponse(actionIdentifier, data) {
  return {
    actionIdentifier,
    notification: {
      request: {
        content: { data }
      }
    }
  }
}

test('Find Device notification action returns only its current ring token', () => {
  const response = notificationResponse(FIND_DEVICE_STOP_ACTION, {
    kind: FIND_DEVICE_NOTIFICATION_KIND,
    ringToken: 'ring-1'
  })

  assert.equal(getFindDeviceStopToken(response), 'ring-1')
  assert.equal(getFindDeviceStopToken({ ...response, actionIdentifier: 'default' }), null)
  assert.equal(
    getFindDeviceStopToken(
      notificationResponse(FIND_DEVICE_STOP_ACTION, { kind: 'other', ringToken: 'ring-1' })
    ),
    null
  )
  assert.equal(
    getFindDeviceStopToken(
      notificationResponse(FIND_DEVICE_STOP_ACTION, {
        kind: FIND_DEVICE_NOTIFICATION_KIND,
        ringToken: ''
      })
    ),
    null
  )
})

test('Find Device notification identifiers are stable per ring', () => {
  assert.equal(findDeviceNotificationIdentifier('ring-1'), 'syncer-find-device-ring-1')
  assert.throws(() => findDeviceNotificationIdentifier(''), /must not be empty/)
})

test('preferred Find Device feedback keeps AlarmKit exclusive when it starts', async () => {
  let legacyStarts = 0
  let alarmDismissals = 0
  const result = await startPreferredFindDeviceFeedback({
    prepareAlarmKit: async () => true,
    startAlarmKit: async () => true,
    dismissAlarmKit: async () => {
      alarmDismissals += 1
    },
    startLegacy: async () => {
      legacyStarts += 1
    }
  })

  assert.deepEqual(result, { backend: 'alarmkit' })
  assert.equal(legacyStarts, 0)
  assert.equal(alarmDismissals, 0)
})

test('preferred Find Device feedback falls back when AlarmKit is unavailable', async () => {
  let legacyStarts = 0
  const result = await startPreferredFindDeviceFeedback({
    prepareAlarmKit: async () => false,
    startAlarmKit: async () => assert.fail('unavailable AlarmKit must not be started'),
    dismissAlarmKit: async () => assert.fail('unavailable AlarmKit must not need cleanup'),
    startLegacy: async () => {
      legacyStarts += 1
    }
  })

  assert.deepEqual(result, { backend: 'legacy' })
  assert.equal(legacyStarts, 1)
})

test('preferred Find Device feedback clears a failed AlarmKit start before fallback', async () => {
  const alarmError = new Error('schedule failed')
  const order = []
  const result = await startPreferredFindDeviceFeedback({
    prepareAlarmKit: async () => true,
    startAlarmKit: async () => {
      order.push('alarm')
      throw alarmError
    },
    dismissAlarmKit: async () => {
      order.push('dismiss')
    },
    startLegacy: async () => {
      order.push('legacy')
    }
  })

  assert.equal(result.backend, 'legacy')
  assert.equal(result.alarmKitError, alarmError)
  assert.deepEqual(order, ['alarm', 'dismiss', 'legacy'])
})

test('preferred Find Device feedback never double-rings after ambiguous AlarmKit failure', async () => {
  let legacyStarts = 0
  await assert.rejects(
    startPreferredFindDeviceFeedback({
      prepareAlarmKit: async () => true,
      startAlarmKit: async () => {
        throw new Error('schedule failed')
      },
      dismissAlarmKit: async () => {
        throw new Error('cleanup failed')
      },
      startLegacy: async () => {
        legacyStarts += 1
      }
    }),
    /could not be cleared/
  )
  assert.equal(legacyStarts, 0)
})

test('preferred Find Device feedback never falls back when AlarmKit preflight is unsafe', async () => {
  let alarmStarts = 0
  let alarmDismissals = 0
  let legacyStarts = 0

  await assert.rejects(
    startPreferredFindDeviceFeedback({
      prepareAlarmKit: async () => {
        throw new Error('orphan cleanup failed')
      },
      startAlarmKit: async () => {
        alarmStarts += 1
        return true
      },
      dismissAlarmKit: async () => {
        alarmDismissals += 1
      },
      startLegacy: async () => {
        legacyStarts += 1
      }
    }),
    /orphan cleanup failed/
  )

  assert.equal(alarmStarts, 0)
  assert.equal(alarmDismissals, 0)
  assert.equal(legacyStarts, 0)
})

test('verified media volume succeeds after the native value catches up', async () => {
  const writes = []
  const reads = [0.4, 1]
  let waits = 0

  await setVerifiedVolume({
    target: 1,
    write: async (volume) => writes.push(volume),
    read: async () => reads.shift(),
    wait: async () => {
      waits += 1
    }
  })

  assert.deepEqual(writes, [1, 1])
  assert.equal(waits, 1)
})

test('verified media volume retries errors but remains bounded', async () => {
  let writes = 0
  let waits = 0

  await assert.rejects(
    setVerifiedVolume({
      target: 0.5,
      maximumAttempts: 3,
      write: async () => {
        writes += 1
      },
      read: async () => {
        throw new Error('native read failed')
      },
      wait: async () => {
        waits += 1
      }
    }),
    /after 3 attempts/
  )

  assert.equal(writes, 3)
  assert.equal(waits, 2)
})
