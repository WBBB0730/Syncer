import { app } from 'electron'

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  let showPrimaryWindow: (() => void) | null = null
  let pendingSecondInstance = false

  app.on('second-instance', () => {
    if (showPrimaryWindow) showPrimaryWindow()
    else pendingSecondInstance = true
  })

  void import('./application')
    .then(({ startApplication }) => startApplication())
    .then((showWindow) => {
      showPrimaryWindow = showWindow
      if (pendingSecondInstance) showWindow()
      if (process.env.SYNCER_STARTUP_SMOKE === '1') app.quit()
    })
    .catch((error) => {
      console.error('Failed to start Syncer', error)
      app.exit(1)
    })
}
