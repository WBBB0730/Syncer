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

interface WindowsFileMoveApi {
  moveFile(source: string, destination: string): number
  getLastError(): number
}

let windowsFileMoveApi: WindowsFileMoveApi | null = null

function getWindowsFileMoveApi(): WindowsFileMoveApi {
  if (process.platform !== 'win32') {
    throw new Error('Atomic file publication is only supported on Windows')
  }
  if (windowsFileMoveApi) return windowsFileMoveApi

  const kernel32 = koffi.load('kernel32.dll')
  windowsFileMoveApi = {
    moveFile: kernel32.func(
      'int32_t __stdcall MoveFileW(str16 source, str16 destination)'
    ) as WindowsFileMoveApi['moveFile'],
    getLastError: kernel32.func(
      'uint32_t __stdcall GetLastError()'
    ) as WindowsFileMoveApi['getLastError']
  }
  return windowsFileMoveApi
}

export function moveNoReplace(source: string, destination: string): boolean {
  if (source.includes('\0') || destination.includes('\0')) {
    throw new TypeError('File paths cannot contain null bytes')
  }
  const { moveFile, getLastError } = getWindowsFileMoveApi()
  if (moveFile(source, destination) !== 0) return true

  const error = getLastError()
  if (error === ERROR_FILE_EXISTS || error === ERROR_ALREADY_EXISTS) return false
  throw new NativeFileMoveError('MoveFileW', error)
}
