import {
  FramedSocket,
  CONNECTION_REQUEST_TIMEOUT_MS,
  HANDSHAKE_TIMEOUT_MS,
  MAX_PENDING_HANDSHAKES,
  PROTOCOL_VERSION,
  TCP_PORT,
  isHandshakeMessage,
  isIpv4Address,
  prioritizeDeviceEndpoint,
  type AvailableDevice,
  type ConnectionAttemptResult,
  type ConnectionRequest,
  type DeviceEndpoint,
  type DeviceIdentity,
  type TcpHandshakeMessage,
} from '@syncer/protocol';
import React from 'react';
import { Text, View } from 'react-native';
import net from 'react-native-tcp-socket';

import { Modal, ModalButton, modalStyles, type ModalToken } from '../components/Modal';
import { isDeviceWhitelisted } from '../repositories/whitelist';
import store from '../store';
import { toUint8Array } from '../utils/bytes';
import { FeedbackDuration, showFeedback } from '../utils/feedback';
import { notify } from '../utils/notify';

type TcpSocket = InstanceType<typeof net.Socket>;
type TcpServer = ReturnType<typeof net.createServer>;
export type DialOptions = { signal?: AbortSignal };
type AttachSession = (
  socket: FramedSocket,
  device: AvailableDevice,
  options: { inbound: boolean },
) => void;
type PresenceFailureHandler = (error: Error) => void;

type EndpointDialResult = {
  result: ConnectionAttemptResult;
  connectionRequestSent: boolean;
};

type PendingConnection = {
  request: ConnectionRequest;
  socket: FramedSocket;
  modalToken?: ModalToken;
  decisionTimer?: ReturnType<typeof setTimeout>;
  acceptanceTimer?: ReturnType<typeof setTimeout>;
  accepting: boolean;
};

let attachSession: AttachSession | null = null;
let presenceFailureHandler: PresenceFailureHandler | null = null;
let server: TcpServer | null = null;
let serverPromise: Promise<void> | null = null;
let pendingConnection: PendingConnection | null = null;
let nextRequestId = 0;

const handshakeTimers = new Map<FramedSocket, ReturnType<typeof setTimeout>>();

export function bindSessionAttacher(fn: AttachSession): void {
  attachSession = fn;
}

export function bindPresenceFailureHandler(fn: PresenceFailureHandler): void {
  presenceFailureHandler = fn;
}

function localHello(): Extract<TcpHandshakeMessage, { type: 'hello' }> {
  return {
    type: 'hello',
    v: PROTOCOL_VERSION,
    uuid: store.uuid,
    name: store.name,
    device: 'mobile',
  };
}

function localConnect(targetUuid: string): Extract<TcpHandshakeMessage, { type: 'connect' }> {
  return {
    type: 'connect',
    v: PROTOCOL_VERSION,
    uuid: store.uuid,
    targetUuid,
    name: store.name,
    device: 'mobile',
  };
}

function sameIdentity(left: DeviceIdentity, right: DeviceIdentity): boolean {
  return left.uuid === right.uuid && left.name === right.name && left.device === right.device;
}

function remoteAddress(socket: TcpSocket): string {
  return (socket.remoteAddress || '').replace(/^::ffff:/, '');
}

function createFramedSocket(socket: TcpSocket): FramedSocket {
  socket.setKeepAlive(true);
  socket.setNoDelay(true);
  return new FramedSocket(socket, toUint8Array);
}

function trackHandshake(socket: FramedSocket, rawSocket: TcpSocket): void {
  const timer = setTimeout(() => socket.destroy(), HANDSHAKE_TIMEOUT_MS);
  handshakeTimers.set(socket, timer);
  rawSocket.once('close', () => {
    releaseHandshake(socket);
    if (pendingConnection?.socket === socket) clearPendingConnection(false);
  });
}

function releaseHandshake(socket: FramedSocket): void {
  const timer = handshakeTimers.get(socket);
  if (timer) clearTimeout(timer);
  handshakeTimers.delete(socket);
}

function clearPendingConnection(destroy: boolean): void {
  const pending = pendingConnection;
  if (!pending) return;
  releasePendingConnection(pending, destroy);
}

function releasePendingConnection(pending: PendingConnection, destroy: boolean): boolean {
  if (pendingConnection !== pending) return false;
  pendingConnection = null;
  if (pending.decisionTimer) clearTimeout(pending.decisionTimer);
  pending.decisionTimer = undefined;
  if (pending.acceptanceTimer) clearTimeout(pending.acceptanceTimer);
  pending.acceptanceTimer = undefined;
  if (pending.modalToken !== undefined) Modal.hide(pending.modalToken);
  pending.modalToken = undefined;
  if (destroy) pending.socket.destroy();
  return true;
}

function beginPendingAcceptance(pending: PendingConnection): boolean {
  if (
    pendingConnection !== pending ||
    pending.accepting ||
    store.status !== 'available'
  ) {
    return false;
  }
  pending.accepting = true;
  if (pending.decisionTimer) clearTimeout(pending.decisionTimer);
  pending.decisionTimer = undefined;
  if (pending.modalToken !== undefined) Modal.hide(pending.modalToken);
  pending.modalToken = undefined;
  pending.acceptanceTimer = setTimeout(() => {
    releasePendingConnection(pending, true);
  }, HANDSHAKE_TIMEOUT_MS);
  return true;
}

async function refuse(
  socket: FramedSocket,
  reason: 'busy' | 'rejected' | 'protocol-error',
): Promise<void> {
  try {
    await socket.sendJson({
      type: 'refuse',
      v: PROTOCOL_VERSION,
      uuid: store.uuid,
      name: store.name,
      reason,
    });
  } finally {
    socket.destroy();
  }
}

async function acceptPending(pending: PendingConnection): Promise<boolean> {
  if (!beginPendingAcceptance(pending)) return false;
  const { socket } = pending;
  try {
    if (!attachSession) throw new Error('Session attacher is not bound');
    await socket.sendJson({ type: 'accept', v: PROTOCOL_VERSION, uuid: store.uuid });
    if (pendingConnection !== pending || store.status !== 'available') {
      socket.destroy();
      return false;
    }
    releasePendingConnection(pending, false);
    releaseHandshake(socket);
    attachSession(socket, pending.request.device, { inbound: true });
    return true;
  } catch (error) {
    releasePendingConnection(pending, false);
    socket.destroy();
    throw error;
  }
}

function showPendingConnection(pending: PendingConnection): void {
  const { device, requestId } = pending.request;
  notify('连接请求', device.name);
  pending.modalToken = Modal.show({
    key: 'connection-request',
    title: '连接请求',
    priority: 'urgent',
    content: React.createElement(Text, null, `${device.name} 请求与你建立连接`),
    footer: React.createElement(
      React.Fragment,
      null,
      React.createElement(
        View,
        { style: { flexGrow: 1 } },
        React.createElement(
          ModalButton,
          {
            type: 'outline',
            onPress: () => {
              void refusePendingConnection(requestId).catch((error) => {
                console.error('Failed to refuse Connection Request', error);
                showFeedback('操作失败', FeedbackDuration.LONG);
              });
            },
          },
          '拒绝',
        ),
      ),
      React.createElement(
        View,
        { style: modalStyles.button },
        React.createElement(
          ModalButton,
          {
            onPress: () => {
              void acceptPendingConnection(requestId).catch((error) => {
                console.error('Failed to accept Connection Request', error);
                showFeedback('操作失败', FeedbackDuration.LONG);
              });
            },
          },
          '接受',
        ),
      ),
    ),
  });
}

async function handleInitialConnect(
  socket: FramedSocket,
  rawSocket: TcpSocket,
  hello: DeviceIdentity | null,
  message: Extract<TcpHandshakeMessage, { type: 'connect' }>,
): Promise<void> {
  if (!hello || !sameIdentity(hello, message) || message.targetUuid !== store.uuid) {
    await refuse(socket, 'protocol-error');
    return;
  }

  if (store.status !== 'available' || pendingConnection) {
    await refuse(socket, 'busy');
    return;
  }

  const address = remoteAddress(rawSocket);
  if (!isIpv4Address(address)) {
    await refuse(socket, 'protocol-error');
    return;
  }

  const device: AvailableDevice = {
    ...hello,
    endpoints: [{ port: TCP_PORT, address }],
  };
  const pending: PendingConnection = {
    request: {
      requestId: String(++nextRequestId),
      device,
    },
    socket,
    accepting: false,
  };

  releaseHandshake(socket);
  pendingConnection = pending;
  pending.decisionTimer = setTimeout(() => {
    releasePendingConnection(pending, true);
  }, CONNECTION_REQUEST_TIMEOUT_MS);

  const whitelisted = await isDeviceWhitelisted(device.uuid);
  if (pendingConnection !== pending) return;
  if (store.status !== 'available') {
    releasePendingConnection(pending, false);
    await refuse(socket, 'busy');
    return;
  }

  if (whitelisted) {
    const attached = await acceptPending(pending);
    if (attached) notify('连接成功', device.name);
    return;
  }

  showPendingConnection(pending);
}

function acceptDoorConnection(rawSocket: TcpSocket): void {
  if (store.status !== 'available' || handshakeTimers.size >= MAX_PENDING_HANDSHAKES) {
    rawSocket.destroy();
    return;
  }

  const socket = createFramedSocket(rawSocket);
  let hello: DeviceIdentity | null = null;
  let connectReceived = false;
  trackHandshake(socket, rawSocket);
  socket.setErrorHandler(() => undefined);
  socket.transferTo(async (frame) => {
    if (!hello && store.status !== 'available') {
      socket.destroy();
      return;
    }
    if (frame.kind !== 'json' || !isHandshakeMessage(frame.message)) {
      await refuse(socket, 'protocol-error');
      return;
    }

    if (frame.message.type === 'hello') {
      if (hello || connectReceived) {
        await refuse(socket, 'protocol-error');
        return;
      }
      hello = frame.message;
      await socket.sendJson(localHello());
      return;
    }

    if (frame.message.type !== 'connect' || connectReceived) {
      await refuse(socket, 'protocol-error');
      return;
    }
    connectReceived = true;
    if (!hello) {
      await refuse(socket, 'protocol-error');
      return;
    }
    if (store.status !== 'available') {
      await refuse(socket, 'busy');
      return;
    }
    await handleInitialConnect(socket, rawSocket, hello, frame.message);
  });
}

export function startPresenceServer(): Promise<void> {
  if (serverPromise) return serverPromise;
  serverPromise = new Promise((resolve, reject) => {
    const nextServer = net.createServer(acceptDoorConnection);
    const onStartupError = (error: Error) => {
      nextServer.removeListener('error', onStartupError);
      serverPromise = null;
      reject(error);
    };
    nextServer.once('error', onStartupError);
    nextServer.listen({ port: TCP_PORT }, () => {
      nextServer.removeListener('error', onStartupError);
      server = nextServer;
      let runtimeError: Error | null = null;
      const invalidate = (error: Error) => {
        if (server !== nextServer) return;
        server = null;
        serverPromise = null;
        clearPendingConnection(true);
        for (const socket of handshakeTimers.keys()) socket.destroy();
        handshakeTimers.clear();
        presenceFailureHandler?.(error);
      };
      nextServer.on('error', (error) => {
        runtimeError = error;
        invalidate(error);
      });
      nextServer.on('close', () => {
        queueMicrotask(() => {
          invalidate(runtimeError ?? new Error('Presence server closed unexpectedly'));
        });
      });
      resolve();
    });
  });
  return serverPromise;
}

export async function stopPresenceServer(): Promise<void> {
  const startup = serverPromise;
  if (startup) {
    try {
      await startup;
    } catch {
      return;
    }
  }

  const current = server;
  server = null;
  serverPromise = null;
  clearPendingConnection(true);
  for (const socket of handshakeTimers.keys()) socket.destroy();
  handshakeTimers.clear();
  if (!current) return;
  current.close();
}

export function probePresence(
  host: string,
  timeoutMs: number,
  options: { signal?: AbortSignal } = {},
): Promise<DeviceIdentity | null> {
  return new Promise((resolve) => {
    const rawSocket = new net.Socket();
    const socket = createFramedSocket(rawSocket);
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const finish = (identity: DeviceIdentity | null): void => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      options.signal?.removeEventListener('abort', onAbort);
      socket.destroy();
      resolve(identity);
    };
    const onAbort = (): void => finish(null);

    timer = setTimeout(() => finish(null), timeoutMs);
    if (options.signal?.aborted) {
      finish(null);
      return;
    }
    options.signal?.addEventListener('abort', onAbort, { once: true });
    socket.setCloseHandler(() => finish(null));
    socket.setErrorHandler(() => finish(null));
    socket.transferTo((frame) => {
      if (frame.kind !== 'json' || frame.message.type !== 'hello') {
        throw new Error('Invalid Presence probe response');
      }
      finish(frame.message);
    });

    try {
      rawSocket.connect({ port: TCP_PORT, host }, () => {
        void socket.sendJson(localHello()).catch(() => finish(null));
      });
    } catch {
      finish(null);
    }
  });
}

export async function dialAndConnect(
  device: AvailableDevice,
  options: DialOptions = {},
): Promise<ConnectionAttemptResult> {
  let lastResult: ConnectionAttemptResult = 'unreachable';
  for (const endpoint of device.endpoints) {
    if (options.signal?.aborted) return 'cancelled';
    const attempt = await dialEndpoint(device, endpoint, options);
    lastResult = attempt.result;
    if (
      attempt.connectionRequestSent ||
      attempt.result === 'accepted' ||
      attempt.result === 'refused' ||
      attempt.result === 'cancelled'
    ) {
      return attempt.result;
    }
  }
  return lastResult;
}

function dialEndpoint(
  device: AvailableDevice,
  endpoint: DeviceEndpoint,
  options: DialOptions,
): Promise<EndpointDialResult> {
  return new Promise((resolve) => {
    const rawSocket = new net.Socket();
    const socket = createFramedSocket(rawSocket);
    let remoteIdentity: DeviceIdentity | null = null;
    let connectionRequestSent = false;
    let settled = false;

    const finish = (result: ConnectionAttemptResult): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      options.signal?.removeEventListener('abort', onAbort);
      socket.destroy();
      resolve({ result, connectionRequestSent });
    };

    const finishAccepted = (): void => {
      if (settled || options.signal?.aborted) return;
      if (!attachSession || !remoteIdentity) {
        finish('protocol-error');
        return;
      }
      socket.suspend();
      try {
        const tcpDevice = {
          ...prioritizeDeviceEndpoint(device, endpoint),
          ...remoteIdentity,
        };
        attachSession(socket, tcpDevice, { inbound: false });
      } catch (error) {
        console.error('Failed to attach accepted Session', error);
        finish('protocol-error');
        return;
      }
      settled = true;
      clearTimeout(timer);
      options.signal?.removeEventListener('abort', onAbort);
      resolve({ result: 'accepted', connectionRequestSent });
    };

    const onAbort = (): void => finish('cancelled');
    let timer = setTimeout(() => finish('timeout'), HANDSHAKE_TIMEOUT_MS);
    options.signal?.addEventListener('abort', onAbort, { once: true });

    socket.setCloseHandler(() => finish(options.signal?.aborted ? 'cancelled' : 'unreachable'));
    socket.setErrorHandler(() => finish(options.signal?.aborted ? 'cancelled' : 'unreachable'));
    socket.transferTo(async (frame) => {
      if (frame.kind !== 'json' || !isHandshakeMessage(frame.message)) {
        finish('protocol-error');
        return;
      }

      const message = frame.message;
      if (message.type === 'hello' && !remoteIdentity && !connectionRequestSent) {
        if (message.uuid !== device.uuid) {
          finish('protocol-error');
          return;
        }
        remoteIdentity = message;
        connectionRequestSent = true;
        try {
          await socket.sendJson(localConnect(message.uuid));
        } catch {
          finish('unreachable');
          return;
        }
        if (!settled) {
          clearTimeout(timer);
          timer = setTimeout(() => finish('timeout'), CONNECTION_REQUEST_TIMEOUT_MS);
        }
        return;
      }

      if (message.type === 'accept' && connectionRequestSent && message.uuid === device.uuid) {
        finishAccepted();
        return;
      }

      if (message.type === 'refuse' && connectionRequestSent && message.uuid === device.uuid) {
        finish(
          message.reason === 'rejected'
            ? 'refused'
            : message.reason === 'busy'
              ? 'busy'
              : 'protocol-error',
        );
        return;
      }

      finish('protocol-error');
    });

    if (options.signal?.aborted) {
      finish('cancelled');
      return;
    }

    try {
      rawSocket.connect({ port: endpoint.port || TCP_PORT, host: endpoint.address }, () => {
        void socket.sendJson(localHello()).catch(() => finish('unreachable'));
      });
    } catch {
      finish('unreachable');
    }
  });
}

export async function acceptPendingConnection(requestId: string): Promise<void> {
  const pending = pendingConnection;
  if (!pending || pending.request.requestId !== requestId || pending.accepting) return;
  if (store.status !== 'available') {
    releasePendingConnection(pending, false);
    await refuse(pending.socket, 'busy');
    return;
  }
  await acceptPending(pending);
}

export async function refusePendingConnection(requestId: string): Promise<void> {
  const pending = pendingConnection;
  if (!pending || pending.request.requestId !== requestId || pending.accepting) return;
  releasePendingConnection(pending, false);
  await refuse(pending.socket, 'rejected');
}

export function rejectPendingConnectionForOutgoing(): boolean {
  const pending = pendingConnection;
  if (!pending) return true;
  if (pending.accepting) return false;
  releasePendingConnection(pending, false);
  void refuse(pending.socket, 'busy').catch(() => pending.socket.destroy());
  return true;
}
