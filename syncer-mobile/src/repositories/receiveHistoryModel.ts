export type ReceiveHistoryItem = {
  name: string;
  time: number;
  locator: string;
};

export type LegacyLocatorMigrator = (
  uri: string | null,
  path: string | null,
  name: string,
) => Promise<string>;

export function createPublishedReceiveHistory(
  files: readonly { name: string; locator: string }[],
  savedAt: number,
): ReceiveHistoryItem[] {
  return parseReceiveHistory(
    [...files].reverse().map((file) => ({
      name: file.name,
      time: savedAt,
      locator: file.locator,
    })),
  );
}

export async function migrateReceiveHistory(
  value: unknown | null,
  migrateLocator: LegacyLocatorMigrator,
): Promise<{ items: ReceiveHistoryItem[]; changed: boolean }> {
  if (value === null) return { items: [], changed: false };
  if (!Array.isArray(value)) throw new TypeError('Receive History must be an array');

  let changed = false;
  const items: ReceiveHistoryItem[] = [];
  for (const valueItem of value) {
    const entry = parseBaseEntry(valueItem);
    if (entry.locator !== undefined) {
      items.push({ name: entry.name, time: entry.time, locator: entry.locator });
      if (entry.uri !== undefined || entry.path !== undefined) changed = true;
      continue;
    }

    const locator = await migrateLocator(
      entry.uri ?? null,
      entry.path ?? null,
      entry.name,
    );
    if (typeof locator !== 'string' || locator.length === 0) {
      throw new TypeError('Saved-file locator migration returned an invalid value');
    }
    items.push({ name: entry.name, time: entry.time, locator });
    changed = true;
  }
  return { items, changed };
}

export function parseReceiveHistory(value: unknown | null): ReceiveHistoryItem[] {
  if (value === null) return [];
  if (!Array.isArray(value)) throw new TypeError('Receive History must be an array');
  return value.map((valueItem) => {
    const entry = parseBaseEntry(valueItem);
    if (entry.locator === undefined) {
      throw new TypeError('Receive History entry requires a saved-file locator');
    }
    return { name: entry.name, time: entry.time, locator: entry.locator };
  });
}

function parseBaseEntry(value: unknown): {
  name: string;
  time: number;
  locator?: string;
  uri?: string;
  path?: string;
} {
  if (!value || typeof value !== 'object') {
    throw new TypeError('Receive History entry must be an object');
  }
  const entry = value as Record<string, unknown>;
  if (typeof entry.name !== 'string' || entry.name.length === 0) {
    throw new TypeError('Receive History entry requires a name');
  }
  if (typeof entry.time !== 'number' || !Number.isFinite(entry.time) || entry.time < 0) {
    throw new TypeError('Receive History entry requires a valid time');
  }
  const locator = optionalNonEmptyString(entry.locator, 'locator');
  const uri = optionalNonEmptyString(entry.uri, 'URI');
  const path = optionalNonEmptyString(entry.path, 'path');
  return {
    name: entry.name,
    time: entry.time,
    ...(locator === undefined ? {} : { locator }),
    ...(uri === undefined ? {} : { uri }),
    ...(path === undefined ? {} : { path }),
  };
}

function optionalNonEmptyString(value: unknown, field: string): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || value.length === 0) {
    throw new TypeError(`Receive History ${field} must be a non-empty string`);
  }
  return value;
}
