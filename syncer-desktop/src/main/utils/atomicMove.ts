import koffi from 'koffi'

const WINDOWS_ERROR_FILE_EXISTS = 80
const WINDOWS_ERROR_ALREADY_EXISTS = 183
const DARWIN_ERROR_FILE_EXISTS = 17
const DARWIN_RENAME_EXCL = 0x00000004

class NativeFileMoveError extends Error {
  constructor(
    readonly syscall: string,
    readonly nativeCode: number
  ) {
    super(`${syscall} failed with system error ${nativeCode}`)
    this.name = 'NativeFileMoveError'
  }
}

interface FileMoveApi {
  moveNoReplace(source: string, destination: string): boolean
}

function createWindowsFileMoveApi(): FileMoveApi {
  const kernel32 = koffi.load('kernel32.dll')
  const moveFile = kernel32.func(
    'int32_t __stdcall MoveFileW(str16 source, str16 destination)'
  ) as (source: string, destination: string) => number
  const getLastError = kernel32.func('uint32_t __stdcall GetLastError()') as () => number

  return {
    moveNoReplace(source, destination) {
      if (moveFile(source, destination) !== 0) return true

      const error = getLastError()
      if (error === WINDOWS_ERROR_FILE_EXISTS || error === WINDOWS_ERROR_ALREADY_EXISTS) {
        return false
      }
      throw new NativeFileMoveError('MoveFileW', error)
    }
  }
}

function createDarwinFileMoveApi(): FileMoveApi {
  const libSystem = koffi.load('/usr/lib/libSystem.B.dylib')
  const renameExclusive = libSystem.func(
    'int renamex_np(const char *source, const char *destination, uint32_t flags)'
  ) as (source: string, destination: string, flags: number) => number

  return {
    moveNoReplace(source, destination) {
      if (renameExclusive(source, destination, DARWIN_RENAME_EXCL) === 0) return true

      const error = koffi.errno()
      if (error === DARWIN_ERROR_FILE_EXISTS) return false
      throw new NativeFileMoveError('renamex_np', error)
    }
  }
}

function createFileMoveApi(): FileMoveApi {
  if (process.platform === 'win32') return createWindowsFileMoveApi()
  if (process.platform === 'darwin') return createDarwinFileMoveApi()
  return {
    moveNoReplace() {
      throw new Error(`Atomic file publication is not supported on ${process.platform}`)
    }
  }
}

const fileMoveApi = createFileMoveApi()

export function moveNoReplace(source: string, destination: string): boolean {
  if (source.includes('\0') || destination.includes('\0')) {
    throw new TypeError('File paths cannot contain null bytes')
  }
  return fileMoveApi.moveNoReplace(source, destination)
}
