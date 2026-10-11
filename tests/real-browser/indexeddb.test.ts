import { afterEach, describe, expect, it } from 'vitest';
import { Loki, LokiIndexedDBAdapter } from '../../src';

const created: string[] = [];

function uniqueName(): string {
  const name = `idb-${crypto.randomUUID()}.db`;
  created.push(name);
  return name;
}

afterEach(async () => {
  for (const name of created.splice(0)) {
    await new Promise<void>((resolve) => {
      const request = indexedDB.deleteDatabase(name);
      request.onsuccess = () => resolve();
      request.onerror = () => resolve();
      request.onblocked = () => resolve();
    });
  }
});

describe('LokiIndexedDBAdapter in a browser', () => {
  it('is supported', async () => {
    await expect(LokiIndexedDBAdapter.isSupported()).resolves.toBe(true);
  });

  it('saves incrementally, reloads and deletes', async () => {
    const name = uniqueName();
    const db = new Loki(name, { adapter: new LokiIndexedDBAdapter() });
    const users = db.addCollection<{ n: number }>('users');
    users.insert(Array.from({ length: 12_000 }, (_, n) => ({ n })));
    await db.saveDatabase();
    users.insert({ n: -1 });
    await db.saveDatabase();

    const reloaded = await Loki.open(name, { adapter: new LokiIndexedDBAdapter() });
    expect(reloaded.getCollection('users')?.count()).toBe(12_001);
    await reloaded.deleteDatabase();
    const empty = await Loki.open(name, { adapter: new LokiIndexedDBAdapter() });
    expect(empty.listCollections()).toEqual([]);
  });
});
