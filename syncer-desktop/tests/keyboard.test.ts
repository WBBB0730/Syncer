import { strict as assert } from 'node:assert'
import test from 'node:test'
import { Key } from '@nut-tree-fork/nut-js'
import {
  COMMAND_KEY_STROKES,
  createCommandExecutor,
  type CommandKeyboardAdapter
} from '../src/main/utils/keyboard.js'

test('Command keys have an exhaustive nut.js mapping', () => {
  assert.deepEqual(COMMAND_KEY_STROKES, {
    up: [Key.Up],
    down: [Key.Down],
    left: [Key.Left],
    right: [Key.Right],
    space: [Key.Space],
    escape: [Key.Escape],
    f5: [Key.F5],
    audio_mute: [Key.AudioMute],
    audio_vol_down: [Key.AudioVolDown],
    audio_vol_up: [Key.AudioVolUp],
    audio_play_pause: [Key.AudioPlay],
    audio_prev: [Key.AudioPrev],
    audio_next: [Key.AudioNext]
  })
})

test('Windows Command execution taps the mapped key without checking Accessibility', async () => {
  const typed: Key[][] = []
  const adapter: CommandKeyboardAdapter = {
    platform: 'win32',
    isTrustedAccessibilityClient() {
      assert.fail('Windows must not check macOS Accessibility')
    },
    async type(...keys) {
      typed.push(keys)
    }
  }

  const result = await createCommandExecutor(adapter)('audio_next')

  assert.deepEqual(result, { ok: true })
  assert.deepEqual(typed, [[Key.AudioNext]])
})

test('macOS requests Accessibility once and retries after permission is granted', async () => {
  const prompts: boolean[] = []
  const typed: Key[][] = []
  let trusted = false
  const adapter: CommandKeyboardAdapter = {
    platform: 'darwin',
    isTrustedAccessibilityClient(prompt) {
      prompts.push(prompt)
      return trusted
    },
    async type(...keys) {
      typed.push(keys)
    }
  }
  const execute = createCommandExecutor(adapter)

  const first = await execute('audio_play_pause')
  const second = await execute('audio_play_pause')
  trusted = true
  const third = await execute('audio_play_pause')

  assert.equal(first.ok, false)
  assert.equal(second.ok, false)
  if (!first.ok) assert.equal(first.reason, 'accessibility-permission-required')
  if (!second.ok) assert.equal(second.reason, 'accessibility-permission-required')
  assert.deepEqual(third, { ok: true })
  assert.deepEqual(prompts, [false, true, false, false])
  assert.deepEqual(typed, [[Key.AudioPlay]])
})

test('unsupported platforms and injection errors return controlled failures', async () => {
  const unsupported = await createCommandExecutor({
    platform: 'linux',
    isTrustedAccessibilityClient() {
      assert.fail('Unsupported platforms must not check Accessibility')
    },
    async type() {
      assert.fail('Unsupported platforms must not inject keys')
    }
  })('space')

  const injectionError = new Error('injection failed')
  const failed = await createCommandExecutor({
    platform: 'win32',
    isTrustedAccessibilityClient() {
      return true
    },
    async type() {
      throw injectionError
    }
  })('audio_prev')

  assert.equal(unsupported.ok, false)
  if (!unsupported.ok) assert.equal(unsupported.reason, 'unsupported-platform')
  assert.equal(failed.ok, false)
  if (!failed.ok) {
    assert.equal(failed.reason, 'injection-failed')
    assert.equal(failed.cause, injectionError)
  }
})
