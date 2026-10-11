import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import {
  Loki,
  LokiEncryptedAdapter,
  LokiMemoryAdapter,
  LokiPartitioningAdapter,
  type LokiPartitioningAdapterOptions,
} from '../../src';

const require = createRequire(import.meta.url);
const LegacyLoki = require('lokijs');

/** Callback key-value store, the contract lokijs adapters expect. */
function callbackStore() {
  const store = new Map<string, string>();
  return {
    store,
    loadDatabase(name: string, callback: (value: string | null) => void) {
      setTimeout(() => callback(store.get(name) ?? null));
    },
    saveDatabase(name: string, value: string, callback: (err: Error | null) => void) {
      store.set(name, value);
      setTimeout(() => callback(null));
    },
    deleteDatabase(name: string, callback: (err: Error | null) => void) {
      store.delete(name);
      setTimeout(() => callback(null));
    },
  };
}

const settle = (run: (callback: (err?: unknown) => void) => void) =>
  new Promise<void>((resolve, reject) => run((err) => (err ? reject(err) : resolve())));

const sample = Array.from({ length: 10 }, (_, i) => ({ i, s: 'x'.repeat(i * 3) }));

function fill(db: any) {
  db.addCollection('users').insert(sample.map((doc) => ({ ...doc })));
  db.addCollection('empty');
  db.addCollection('gods').insert({ name: 'odin' });
}

const contents = (db: any) =>
  db.collections.map((c: any) => [
    c.name,
    c.data.map(({ $loki, i, s, name }: any) => ({ $loki, i, s, name })),
  ]);

for (const paging of [false, true]) {
  const options: LokiPartitioningAdapterOptions = paging ? { paging: true, pageSize: 50 } : {};

  describe(`LokiPartitioningAdapter and lokijs 1.5.12 (paging: ${paging})`, () => {
    it('opens a database written by lokijs', async () => {
      const kv = callbackStore();
      const legacy = new LegacyLoki('app.db', {
        adapter: new LegacyLoki.LokiPartitioningAdapter(kv, options),
      });
      fill(legacy);
      await settle((done) => legacy.saveDatabase(done));
      if (paging) {
        expect(kv.store.has('app.db.0.1')).toBe(true);
      }

      const db = await Loki.open('app.db', { adapter: new LokiPartitioningAdapter(kv, options) });

      expect(contents(db)).toEqual(contents(legacy));
    });

    it('writes with generations: false what lokijs opens, removals included', async () => {
      const kv = callbackStore();
      const db = new Loki('app.db', {
        adapter: new LokiPartitioningAdapter(kv, { ...options, generations: false }),
      });
      fill(db);
      await db.saveDatabase();
      db.removeCollection('users');
      db.getCollection('gods')?.insert({ name: 'thor' });
      await db.saveDatabase();

      const legacy = new LegacyLoki('app.db', {
        adapter: new LegacyLoki.LokiPartitioningAdapter(kv, options),
      });
      await settle((done) => legacy.loadDatabase({}, done));

      expect(contents(legacy)).toEqual(contents(db));
    });
  });
}

describe('LokiEncryptedAdapter under LokiPartitioningAdapter', () => {
  const encrypted = (inner: LokiMemoryAdapter) =>
    new LokiPartitioningAdapter(
      new LokiEncryptedAdapter(inner, { secret: 'partitioned secret', iterations: 1000 }),
      { paging: true, pageSize: 100 },
    );

  it('round-trips a paged database, stores nothing in clear, and deletes it', async () => {
    const inner = new LokiMemoryAdapter();
    const db = new Loki('enc.db', { adapter: encrypted(inner) });
    const users = db.addCollection('users');
    users.insert(Array.from({ length: 20 }, (_, i) => ({ i, name: `distinctive-${i}` })));
    await db.saveDatabase();
    users.insert({ i: 99, name: 'distinctive-99' });
    await db.saveDatabase();

    const keys = Object.keys(inner.hashStore);
    expect(keys.length).toBeGreaterThan(3);
    for (const key of keys) {
      expect(inner.hashStore[key].value).not.toContain('distinctive');
    }
    const reopened = await Loki.open('enc.db', { adapter: encrypted(inner) });
    expect(reopened.getCollection('users')?.count()).toBe(21);
    expect(reopened.getCollection('users')?.findOne({ i: 99 })?.name).toBe('distinctive-99');

    await reopened.deleteDatabase();
    expect(Object.keys(inner.hashStore)).toEqual([]);
  });
});
