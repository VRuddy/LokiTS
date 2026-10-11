import 'fake-indexeddb/auto';
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import { Loki, LokiIndexedDBAdapter } from '../../src';

const require = createRequire(import.meta.url);
// in an application: import LokiIndexedAdapter from 'lokijs/src/loki-indexed-adapter.js'
const LokiIndexedAdapter = require('lokijs/src/loki-indexed-adapter.js');

/** Recipe documented in tutorials/Persistence Adapters.md: run it at startup until every device has migrated. */
async function migrateFromLokiIndexedAdapter(name: string): Promise<Loki> {
  const db = await Loki.open(name, { adapter: new LokiIndexedDBAdapter() });
  if (db.listCollections().length > 0) {
    return db;
  }
  const legacy = new LokiIndexedAdapter('loki');
  const old = await Loki.open(name, { adapter: legacy });
  if (old.listCollections().length === 0) {
    return db;
  }
  db.loadJSON(old.serialize());
  await db.saveDatabase();
  await old.deleteDatabase();
  return db;
}

describe('migration from the LokiJS LokiIndexedAdapter', () => {
  it('moves a database to LokiIndexedDBAdapter, then leaves it alone', async () => {
    const legacy = new LokiIndexedAdapter('loki');
    const old = await Loki.open('app.db', { adapter: legacy });
    old.addCollection('users').insert([{ name: 'odin' }, { name: 'thor' }]);
    await old.saveDatabase();

    const migrated = await migrateFromLokiIndexedAdapter('app.db');
    expect(migrated.getCollection('users')?.count()).toBe(2);

    const reopened = await Loki.open('app.db', { adapter: new LokiIndexedDBAdapter() });
    expect(reopened.getCollection('users')?.count()).toBe(2);
    const leftover = await Loki.open('app.db', { adapter: new LokiIndexedAdapter('loki') });
    expect(leftover.listCollections()).toEqual([]);

    reopened.getCollection('users')!.insert({ name: 'loki' });
    await reopened.saveDatabase();
    const again = await migrateFromLokiIndexedAdapter('app.db');
    expect(again.getCollection('users')?.count()).toBe(3);
  });

  it('starts empty when there is nothing to migrate', async () => {
    const db = await migrateFromLokiIndexedAdapter('fresh.db');
    expect(db.listCollections()).toEqual([]);
  });
});
