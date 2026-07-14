import { strict as assert } from 'node:assert'
import { join, resolve } from 'node:path'
import { test } from 'node:test'
import {
  APP_RENDERER_ORIGIN,
  APP_RENDERER_URL,
  isAllowedPermissionCheck,
  isAllowedPermissionRequest,
  isTrustedRendererFrame,
  isTrustedRendererOrigin,
  isTrustedRendererUrl,
  resolveRendererRequestPath
} from '../src/main/security'

test('production renderer trust is limited to the main app document', (context) => {
  const developmentUrl = process.env.ELECTRON_RENDERER_URL
  context.after(() => {
    if (developmentUrl === undefined) delete process.env.ELECTRON_RENDERER_URL
    else process.env.ELECTRON_RENDERER_URL = developmentUrl
  })
  delete process.env.ELECTRON_RENDERER_URL

  assert.equal(isTrustedRendererUrl(APP_RENDERER_URL), true)
  assert.equal(isTrustedRendererUrl('app://./assets/index.js'), false)
  assert.equal(isTrustedRendererUrl('app://other/index.html'), false)
  assert.equal(isTrustedRendererUrl('https://example.com/'), false)
  assert.equal(isTrustedRendererOrigin(APP_RENDERER_ORIGIN), true)
  assert.equal(isTrustedRendererOrigin('app://other'), false)
  assert.equal(isTrustedRendererOrigin('null'), false)
})

test('development renderer trust uses only the configured origin', (context) => {
  const developmentUrl = process.env.ELECTRON_RENDERER_URL
  context.after(() => {
    if (developmentUrl === undefined) delete process.env.ELECTRON_RENDERER_URL
    else process.env.ELECTRON_RENDERER_URL = developmentUrl
  })
  process.env.ELECTRON_RENDERER_URL = 'http://localhost:5173/'

  assert.equal(isTrustedRendererOrigin('http://localhost:5173'), true)
  assert.equal(isTrustedRendererOrigin('http://127.0.0.1:5173'), false)
  assert.equal(isTrustedRendererUrl('http://localhost:5173/index.html'), true)
  assert.equal(isTrustedRendererUrl('http://localhost:5174/index.html'), false)
})

test('app protocol requests cannot escape the renderer output directory', () => {
  const rendererDirectory = resolve('renderer-output')
  assert.equal(
    resolveRendererRequestPath('app://./assets/index.js', rendererDirectory),
    join(rendererDirectory, 'assets', 'index.js')
  )
  assert.equal(resolveRendererRequestPath('app://./..%2Fsecret.txt', rendererDirectory), null)
  assert.equal(resolveRendererRequestPath('app://other/index.html', rendererDirectory), null)
  assert.equal(resolveRendererRequestPath('file:///index.html', rendererDirectory), null)
})

test('permission requests allow only notifications and sanitized clipboard writes', () => {
  assert.equal(isAllowedPermissionRequest('notifications', true), true)
  assert.equal(isAllowedPermissionRequest('clipboard-sanitized-write', true), true)
  assert.equal(isAllowedPermissionRequest('clipboard-read', true), false)
  assert.equal(isAllowedPermissionRequest('notifications', false), false)
  assert.equal(isAllowedPermissionRequest('clipboard-sanitized-write', false), false)
})

test('permission checks handle null notification WebContents without weakening clipboard trust', () => {
  assert.equal(isTrustedRendererFrame(APP_RENDERER_ORIGIN, true, APP_RENDERER_URL), true)
  assert.equal(isTrustedRendererFrame(APP_RENDERER_ORIGIN, false, APP_RENDERER_URL), false)
  assert.equal(isTrustedRendererFrame('https://example.com', true, APP_RENDERER_URL), false)
  assert.equal(isTrustedRendererFrame(APP_RENDERER_ORIGIN, true, 'https://example.com'), false)

  assert.equal(isAllowedPermissionCheck('notifications', true, false), true)
  assert.equal(isAllowedPermissionCheck('clipboard-sanitized-write', true, true), true)
  assert.equal(isAllowedPermissionCheck('clipboard-sanitized-write', true, false), false)
  assert.equal(isAllowedPermissionCheck('clipboard-read', true, true), false)
  assert.equal(isAllowedPermissionCheck('notifications', false, true), false)
})
