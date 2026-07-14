export type KeyValueStorage = {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
};

export function createSerializedStorage(backend: KeyValueStorage, prefix = '@syncer/') {
  let operationTail = Promise.resolve();

  function enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const result = operationTail.then(operation);
    operationTail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  async function load<T>(key: string): Promise<T | null> {
    const current = await backend.getItem(`${prefix}${key}`);
    if (current !== null) return JSON.parse(current) as T;

    const legacy = await backend.getItem(key);
    if (legacy === null) return null;
    const value = parseLegacyValue(legacy) as T;
    await backend.setItem(`${prefix}${key}`, JSON.stringify(value));
    return value;
  }

  return {
    get<T = unknown>(key: string): Promise<T | null> {
      return enqueue(() => load<T>(key));
    },

    set<T>(key: string, value: T): Promise<void> {
      return enqueue(() => backend.setItem(`${prefix}${key}`, JSON.stringify(value)));
    },

    mutate<T>(key: string, mutate: (current: unknown | null) => T): Promise<T> {
      return enqueue(async () => {
        const next = mutate(await load<unknown>(key));
        await backend.setItem(`${prefix}${key}`, JSON.stringify(next));
        return next;
      });
    },
  };
}

function parseLegacyValue(encoded: string): unknown {
  const wrapper = JSON.parse(encoded) as unknown;
  if (
    !wrapper ||
    typeof wrapper !== 'object' ||
    !Object.hasOwn(wrapper, 'rawData')
  ) {
    throw new TypeError('Legacy storage value is malformed');
  }
  return (wrapper as { rawData: unknown }).rawData;
}
