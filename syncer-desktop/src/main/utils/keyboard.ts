import { systemPreferences } from 'electron'
import { Key, keyboard } from '@nut-tree-fork/nut-js'
import type { CommandKey } from '@syncer/protocol'

export const COMMAND_KEY_STROKES: Record<CommandKey, Key[]> = {
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
}

export type CommandFailureReason =
  'unsupported-platform' | 'accessibility-permission-required' | 'injection-failed'

export type CommandExecutionResult =
  | { ok: true }
  | {
      ok: false
      reason: CommandFailureReason
      message: string
      cause?: unknown
    }

export interface CommandKeyboardAdapter {
  readonly platform: NodeJS.Platform
  isTrustedAccessibilityClient(prompt: boolean): boolean
  type(...keys: Key[]): Promise<void>
}

export function createCommandExecutor(
  adapter: CommandKeyboardAdapter
): (command: CommandKey) => Promise<CommandExecutionResult> {
  let accessibilityPromptRequested = false

  return async (command) => {
    if (adapter.platform !== 'win32' && adapter.platform !== 'darwin') {
      return {
        ok: false,
        reason: 'unsupported-platform',
        message: `当前系统（${adapter.platform}）不支持执行 Command`
      }
    }

    if (adapter.platform === 'darwin') {
      try {
        let trusted = adapter.isTrustedAccessibilityClient(false)
        if (!trusted && !accessibilityPromptRequested) {
          accessibilityPromptRequested = true
          trusted = adapter.isTrustedAccessibilityClient(true)
        }
        if (!trusted) {
          return {
            ok: false,
            reason: 'accessibility-permission-required',
            message: '请在系统设置中允许 Syncer 使用辅助功能'
          }
        }
      } catch (cause) {
        return {
          ok: false,
          reason: 'injection-failed',
          message: '检查辅助功能权限失败',
          cause
        }
      }
    }

    try {
      await adapter.type(...COMMAND_KEY_STROKES[command])
      return { ok: true }
    } catch (cause) {
      return {
        ok: false,
        reason: 'injection-failed',
        message: '桌面端执行 Command 失败',
        cause
      }
    }
  }
}

export const executeKeyboardCommand = createCommandExecutor({
  platform: process.platform,
  isTrustedAccessibilityClient: (prompt) => systemPreferences.isTrustedAccessibilityClient(prompt),
  type: async (...keys) => {
    await keyboard.type(...keys)
  }
})
