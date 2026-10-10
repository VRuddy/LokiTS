import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { Loki } from '../../src';
import { IncrementalIndexedDBAdapter } from '../helpers/incremental-idb';

const adapter = (appname: string) => new IncrementalIndexedDBAdapter(appname);

describe('IncrementalIndexedDBAdapter through Loki', () => {
  it('saves, reloads into a new Loki and deletes', async () => {
    const db = new Loki('idb.db', { adapter: adapter('roundtrip') });
    const users = db.addCollection<{ name: string }>('users');
    users.insert([{ name: 'odin' }, { name: 'thor' }]);
    await db.saveDatabase();
    users.insert({ name: 'loki' });
    await db.saveDatabase();

    const reloaded = await Loki.open('idb.db', { adapter: adapter('roundtrip') });
    expect(reloaded.getCollection('users')?.count()).toBe(3);
    expect(
      reloaded
        .getCollection<{ name: string }>('users')
        ?.find()
        .map((doc) => doc.name)
        .sort(),
    ).toEqual(['loki', 'odin', 'thor']);

    await reloaded.deleteDatabase();
    const afterDelete = await Loki.open('idb.db', { adapter: adapter('roundtrip') });
    expect(afterDelete.listCollections()).toEqual([]);
  });
});
