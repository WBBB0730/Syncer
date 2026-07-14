import { isAbsolute, relative, resolve, sep } from 'path'

export const APP_SCHEME = 'app'
export const APP_HOST = '.'
export const APP_RENDERER_ORIGIN = 'app://.'
export const APP_RENDERER_URL = 'app://./index.html'

export function resolveRendererRequestPath(
  value: string,
  rendererDirectory: string
): string | null {
  try {
    const url = new URL(value)
    if (
      url.protocol !== `${APP_SCHEME}:` ||
      url.host !== APP_HOST ||
      url.username !== '' ||
      url.password !== '' ||
      url.port !== ''
    ) {
      return null
    }

    const pathname = decodeURIComponent(url.pathname)
    if (!pathname.startsWith('/') || pathname.includes('\0')) return null

    const root = resolve(rendererDirectory)
    const path = resolve(root, `.${pathname}`)
    const child = relative(root, path)
    if (child === '' || child === '..' || child.startsWith(`..${sep}`) || isAbsolute(child)) {
      return null
    }
    return path
  } catch {
    return null
  }
}

export function isTrustedRendererUrl(value: string): boolean {
  try {
    const url = new URL(value)
    const developmentUrl = process.env['ELECTRON_RENDERER_URL']
    if (developmentUrl) return url.origin === new URL(developmentUrl).origin
    return (
      url.protocol === `${APP_SCHEME}:` &&
      url.host === APP_HOST &&
      url.pathname === '/index.html' &&
      url.username === '' &&
      url.password === '' &&
      url.port === '' &&
      url.search === '' &&
      url.hash === ''
    )
  } catch {
    return false
  }
}

export function isTrustedRendererOrigin(value: string): boolean {
  try {
    const developmentUrl = process.env['ELECTRON_RENDERER_URL']
    if (developmentUrl) return value === new URL(developmentUrl).origin
    return value === APP_RENDERER_ORIGIN
  } catch {
    return false
  }
}

export function isTrustedRendererFrame(
  requestingOrigin: string,
  isMainFrame: boolean,
  requestingUrl?: string
): boolean {
  return (
    isMainFrame &&
    isTrustedRendererOrigin(requestingOrigin) &&
    (requestingUrl === undefined || isTrustedRendererUrl(requestingUrl))
  )
}

export function isAllowedPermissionRequest(
  permission: string,
  trustedMainRenderer: boolean
): boolean {
  return (
    trustedMainRenderer &&
    (permission === 'notifications' || permission === 'clipboard-sanitized-write')
  )
}

export function isAllowedPermissionCheck(
  permission: string,
  trustedRendererFrame: boolean,
  trustedMainRenderer: boolean
): boolean {
  if (!trustedRendererFrame) return false
  if (permission === 'notifications') return true
  return permission === 'clipboard-sanitized-write' && trustedMainRenderer
}

export function isSafeExternalUrl(value: string): boolean {
  try {
    const protocol = new URL(value).protocol
    return protocol === 'https:' || protocol === 'http:'
  } catch {
    return false
  }
}
