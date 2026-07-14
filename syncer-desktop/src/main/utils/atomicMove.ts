import koffi from 'koffi'

const ERROR_FILE_EXISTS = 80
const ERROR_ALREADY_EXISTS = 183

class NativeFileMoveError extends Error {
  constructor(
    readonly syscall: string,
    readonly nativeCode: number
  ) {
    super(`${syscall} failed with system error ${nativeCode}`)
    this.name = 'NativeFileMoveError'
  }
}

const kernel32 = koffi.load('kernel32.dll')
const moveFile = kernel32.func('int32_t __stdcall MoveFileW(str16 source, str16 destination)') as (
  source: string,
  destination: string
) => number
const getLastError = kernel32.func('uint32_t __stdcall GetLastError()') as () => number

export function moveNoReplace(source: string, destination: string): boolean {
  if (source.includes('\0') || destination.includes('\0')) {
    throw new TypeError('File paths cannot contain null bytes')
  }
  if (moveFile(source, destination) !== 0) return true

  const error = getLastError()
  if (error === ERROR_FILE_EXISTS || error === ERROR_ALREADY_EXISTS) return false
  throw new NativeFileMoveError('MoveFileW', error)
}
