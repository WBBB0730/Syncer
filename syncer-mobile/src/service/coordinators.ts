export class LatestStateCoordinator<T> {
  private desired: T;
  private transition = Promise.resolve();

  constructor(initial: T) {
    this.desired = initial;
  }

  set(value: T, reconcile: (desired: () => T) => Promise<void>): Promise<void> {
    this.desired = value;
    return this.runExclusive(() => reconcile(() => this.desired));
  }

  runExclusive(operation: () => Promise<void>): Promise<void> {
    const queuedOperation = this.transition.then(operation);
    this.transition = queuedOperation.catch(() => undefined);
    return queuedOperation;
  }

  replaceDesired(value: T): void {
    this.desired = value;
  }

  get value(): T {
    return this.desired;
  }
}

export class SerialTaskQueue {
  private tail = Promise.resolve();

  run<T>(task: () => Promise<T>): Promise<T> {
    const operation = this.tail.then(task);
    this.tail = operation.then(
      () => undefined,
      () => undefined,
    );
    return operation;
  }
}

export class ExclusiveOwnership<T extends object> {
  private owned: T | null = null;
  private readonly onActiveChange: (active: boolean) => void;

  constructor(onActiveChange: (active: boolean) => void) {
    this.onActiveChange = onActiveChange;
  }

  acquire(value: T): void {
    if (this.owned) throw new Error('Exclusive ownership is already active');
    this.owned = value;
    this.onActiveChange(true);
  }

  release(): T | null {
    const value = this.owned;
    if (!value) return null;
    this.owned = null;
    this.onActiveChange(false);
    return value;
  }

  get current(): T | null {
    return this.owned;
  }
}

export class RestorableValueSnapshot<T> {
  private captured = false;
  private value!: T;

  async capture(read: () => Promise<T>): Promise<void> {
    if (this.captured) return;
    const value = await read();
    this.value = value;
    this.captured = true;
  }

  async restore(write: (value: T) => Promise<void>): Promise<void> {
    if (!this.captured) return;
    await write(this.value);
    this.captured = false;
  }

  get hasValue(): boolean {
    return this.captured;
  }
}

export type QueuePriority = 'normal' | 'urgent';

export type Prioritized<T> = {
  value: T;
  priority: QueuePriority;
};

export class BoundedPriorityQueue<T> {
  private readonly capacity: number;
  private readonly urgentCapacity = 2;
  private urgent: Prioritized<T>[] = [];
  private currentNormal: Prioritized<T> | null = null;
  private pendingNormal: Prioritized<T>[] = [];

  constructor(capacity: number) {
    if (!Number.isSafeInteger(capacity) || capacity <= this.urgentCapacity) {
      throw new Error('Queue capacity must reserve normal and urgent interaction slots');
    }
    this.capacity = capacity;
  }

  enqueue(entry: Prioritized<T>): Prioritized<T> {
    if (entry.priority === 'urgent') {
      if (!this.canEnqueue('urgent')) throw new Error('Urgent interaction limit exceeded');
      this.urgent.unshift(entry);
      return entry;
    }
    if (!this.canEnqueue('normal')) throw new Error('Pending interaction limit exceeded');
    if (!this.currentNormal) {
      this.currentNormal = entry;
      return entry;
    }
    this.pendingNormal.push(entry);
    return this.active!;
  }

  upsert(entry: Prioritized<T>, matches: (value: T) => boolean): Prioritized<T> {
    const urgentIndex = this.urgent.findIndex((item) => matches(item.value));
    if (urgentIndex !== -1) {
      if (entry.priority === 'urgent') {
        this.urgent[urgentIndex] = entry;
        return this.active!;
      }
      this.urgent.splice(urgentIndex, 1);
      return this.enqueue(entry);
    }
    if (this.currentNormal && matches(this.currentNormal.value)) {
      if (entry.priority === 'normal') {
        this.currentNormal = entry;
        return this.active!;
      }
      this.currentNormal = this.pendingNormal.shift() ?? null;
      return this.enqueue(entry);
    }
    const pendingIndex = this.pendingNormal.findIndex((item) => matches(item.value));
    if (pendingIndex !== -1) {
      if (entry.priority === 'normal') {
        this.pendingNormal[pendingIndex] = entry;
        return this.active!;
      }
      this.pendingNormal.splice(pendingIndex, 1);
      return this.enqueue(entry);
    }
    return this.enqueue(entry);
  }

  remove(matches: (value: T) => boolean): Prioritized<T> | null {
    const urgentIndex = this.urgent.findIndex((item) => matches(item.value));
    if (urgentIndex !== -1) {
      this.urgent.splice(urgentIndex, 1);
    } else if (this.currentNormal && matches(this.currentNormal.value)) {
      this.currentNormal = this.pendingNormal.shift() ?? null;
    } else {
      this.pendingNormal = this.pendingNormal.filter((entry) => !matches(entry.value));
    }
    return this.active;
  }

  canEnqueue(priority: QueuePriority): boolean {
    return priority === 'urgent'
      ? this.urgent.length < this.urgentCapacity
      : this.normalSize < this.capacity - this.urgentCapacity;
  }

  get active(): Prioritized<T> | null {
    return this.urgent[0] ?? this.currentNormal;
  }

  get size(): number {
    return this.normalSize + this.urgent.length;
  }

  get normalSize(): number {
    return this.pendingNormal.length + (this.currentNormal ? 1 : 0);
  }
}
