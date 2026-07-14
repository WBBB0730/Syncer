import { keyTap } from '@nut-tree-fork/libnut-win32'
import type { CommandKey } from '@syncer/protocol'

export function executeWindowsCommand(command: CommandKey): void {
  keyTap(command)
}
