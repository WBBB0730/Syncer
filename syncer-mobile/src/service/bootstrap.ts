import { RestartableRuntime } from '@syncer/protocol';

import store from '../store';
import {
  bindDiscoveryFailureHandler,
  markPresenceReady,
  startDiscovery,
  stopDiscovery,
} from './discovery';
import {
  bindPresenceFailureHandler,
  bindSessionAttacher,
  startPresenceServer,
  stopPresenceServer,
} from './presence';
import {
  attachSessionSocket,
  initializeSessionStorage,
} from './session';

let storagePromise: Promise<void> | null = null;

const networkRuntime = new RestartableRuntime({
  start: startNetworkComponents,
  stop: stopNetworkComponents,
});
const recoveryController = new AbortController();

bindPresenceFailureHandler((error) => {
  recoverNetworkRuntime('Presence server stopped unexpectedly', error);
});

bindDiscoveryFailureHandler((error) => {
  recoverNetworkRuntime('Discovery socket stopped unexpectedly', error);
});

export async function startNetworkStack(): Promise<void> {
  await store.whenReady();
  await initializeStorageOnce();
  bindSessionAttacher(attachSessionSocket);
  await networkRuntime.ensureRunning();
}

async function startNetworkComponents(): Promise<void> {
  await startPresenceServer();
  markPresenceReady();
  await startDiscovery();
}

async function stopNetworkComponents(): Promise<void> {
  const results = await Promise.allSettled([stopDiscovery(), stopPresenceServer()]);
  const errors = results.flatMap((result) =>
    result.status === 'rejected' ? [result.reason] : [],
  );
  if (errors.length === 1) throw errors[0];
  if (errors.length > 1) {
    throw new AggregateError(errors, 'Failed to stop the network stack');
  }
}

function recoverNetworkRuntime(message: string, error: Error): void {
  console.warn(message, error);
  void networkRuntime
    .recover({
      signal: recoveryController.signal,
      onError: (recoveryError, nextRetryDelayMs) =>
        console.error(
          `Failed to recover the network stack; retrying in ${nextRetryDelayMs} ms`,
          recoveryError,
        ),
    })
    .catch((recoveryError) =>
      console.error('Network recovery stopped unexpectedly', recoveryError),
    );
}

function initializeStorageOnce(): Promise<void> {
  if (!storagePromise) {
    const initialization = initializeSessionStorage();
    storagePromise = initialization;
    void initialization.catch(() => {
      if (storagePromise === initialization) storagePromise = null;
    });
  }
  return storagePromise;
}
