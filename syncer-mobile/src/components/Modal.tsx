import { Button, Overlay, type ButtonProps } from '@rneui/themed';
import { MAX_PENDING_USER_INTERACTIONS } from '@syncer/protocol';
import React, { ReactNode, useSyncExternalStore } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { BoundedPriorityQueue, type QueuePriority } from '../service/coordinators';
import theme from '../styles/theme';

type ModalOptions = {
  key?: string;
  title?: string;
  content?: ReactNode;
  footer?: ReactNode;
  priority?: QueuePriority;
};

export type ModalToken = number;
type ModalEntry = Required<Omit<ModalOptions, 'priority' | 'key'>> & {
  token: ModalToken;
  key?: string;
};

const availabilityListeners = new Set<() => void>();
const stateListeners = new Set<() => void>();
const queue = new BoundedPriorityQueue<ModalEntry>(MAX_PENDING_USER_INTERACTIONS);
let nextToken = 0;
let current: ModalEntry | null = null;

function emitState(): void {
  current = queue.active?.value ?? null;
  for (const listener of stateListeners) listener();
}

const Modal = {
  show: ({
    key,
    title = '',
    content = <></>,
    footer = <></>,
    priority = 'normal',
  }: ModalOptions): ModalToken => {
    const token = ++nextToken;
    const entry = { token, key, title, content, footer };
    if (key) {
      queue.upsert(
        { value: entry, priority },
        (existing) => existing.key === key,
      );
    } else {
      queue.enqueue({ value: entry, priority });
    }
    emitState();
    return token;
  },
  hide: (token?: ModalToken): void => {
    const target = token ?? queue.active?.value.token;
    if (target === undefined) return;
    const normalSize = queue.normalSize;
    queue.remove((entry) => entry.token === target);
    emitState();
    if (queue.normalSize < normalSize) {
      for (const listener of availabilityListeners) listener();
    }
  },
  canShow: (priority: QueuePriority = 'normal'): boolean => queue.canEnqueue(priority),
  subscribeAvailability: (listener: () => void): (() => void) => {
    availabilityListeners.add(listener);
    return () => availabilityListeners.delete(listener);
  },
  subscribe: (listener: () => void): (() => void) => {
    stateListeners.add(listener);
    return () => stateListeners.delete(listener);
  },
  getSnapshot: (): ModalEntry | null => current,
};

type ModalButtonProps = Omit<ButtonProps, 'children'> & { children?: ReactNode };

export function ModalButton(props: ModalButtonProps) {
  return <Button {...props} />;
}

export default function GlobalModal({ children }: { children?: ReactNode }) {
  const currentEntry = useSyncExternalStore(
    Modal.subscribe,
    Modal.getSnapshot,
    Modal.getSnapshot,
  );

  return (
    <Overlay isVisible={currentEntry !== null} overlayStyle={modalStyles.modal}>
      <Text style={modalStyles.title}>{currentEntry?.title}</Text>
      <ScrollView style={modalStyles.content}>{currentEntry?.content}</ScrollView>
      <View style={modalStyles.footer}>{currentEntry?.footer}</View>
      {children}
    </Overlay>
  );
}

const modalStyles = StyleSheet.create({
  modal: {
    display: 'flex',
    gap: 16,
    width: '80%',
    maxHeight: '80%',
    padding: 16,
    borderRadius: 8,
    backgroundColor: theme.bgColorWhite,
    overflow: 'scroll',
  },
  title: {
    color: theme.mainTextColor,
    fontSize: 16,
    fontWeight: 'bold',
  },
  content: {
    flexShrink: 1,
    overflow: 'scroll',
  },
  footer: {
    display: 'flex',
    flexDirection: 'row',
    gap: 16,
  },
  button: {
    flexGrow: 1,
  },
});

export { Modal, modalStyles };
