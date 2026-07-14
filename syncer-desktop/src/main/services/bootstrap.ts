import { RestartableRuntime } from '@syncer/protocol'
import {
  bindPresenceFailureHandler,
  bindSessionAttacher,
  startPresenceServer,
  stopPresenceServer
} from './presence'
import { attachSessionSocket, initializeSessionStorage, shutdownSession } from './session'
import { bindDiscoveryFailureHandler, startDiscovery, stopDiscovery } from './discovery'
import { abortActiveConnectionAttempt } from './connection'

const networkRuntime = new RestartableRuntime({
  start: startNetworkComponents,
  stop: stopNetworkComponents
})
let recoveryController = new AbortController()

bindPresenceFailureHandler((error) => {
  recoverNetworkRuntime('Presence server stopped unexpectedly', error)
})

bindDiscoveryFailureHandler((error) => {
  recoverNetworkRuntime('Discovery socket stopped unexpectedly', error)
})

export async function startNetworkStack(): Promise<void> {
  if (recoveryController.signal.aborted) recoveryController = new AbortController()
  bindSessionAttacher((socket, device) => attachSessionSocket(socket, device))
  await initializeSessionStorage()
  await networkRuntime.ensureRunning()
}

async function startNetworkComponents(): Promise<void> {
  await startPresenceServer()
  await startDiscovery()
}

async function stopNetworkComponents(): Promise<void> {
  const results = await Promise.allSettled([stopDiscovery(), stopPresenceServer()])
  const errors = results.flatMap((result) => (result.status === 'rejected' ? [result.reason] : []))
  if (errors.length === 1) throw errors[0]
  if (errors.length > 1) {
    throw new AggregateError(errors, 'Failed to stop the network stack')
  }
}

function recoverNetworkRuntime(message: string, error: Error): void {
  console.error(message, error)
  void networkRuntime
    .recover({
      signal: recoveryController.signal,
      onError: (recoveryError, nextRetryDelayMs) =>
        console.error(
          `Failed to recover the network stack; retrying in ${nextRetryDelayMs} ms`,
          recoveryError
        )
    })
    .catch((recoveryError) => console.error('Network recovery stopped unexpectedly', recoveryError))
}

export async function stopNetworkStack(): Promise<void> {
  abortActiveConnectionAttempt()
  recoveryController.abort()
  const results = await Promise.allSettled([networkRuntime.ensureStopped(), shutdownSession()])
  const errors = results.flatMap((result) => (result.status === 'rejected' ? [result.reason] : []))
  if (errors.length === 1) throw errors[0]
  if (errors.length > 1) {
    throw new AggregateError(errors, 'Failed to stop the network stack')
  }
}
