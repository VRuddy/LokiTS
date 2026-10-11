import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Loki, LokiIndexedDBAdapter } from '../../src';
import { flush } from '../helpers/fake-adapters';

let counter = 0;
const uniqueName = (label: string) => `${label}-${++counter}.db`;

function rawGet(dbname: string, key: string): Promise<{ key: string; value: string } | undefined> {
  return new Promise((resolve, reject) => {
    const open = indexedDB.open(dbname, 1);
    open.onsuccess = () => {
      const req = open.result
        .transaction('LokiIncrementalData')
        .objectStore('LokiIncrementalData')
        .get(key);
      req.onsuccess = () => {
        open.result.close();
        resolve(req.result);
      };
      req.onerror = () => reject(req.error);
    };
    open.onerror = () => reject(open.error);
  });
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('LokiIndexedDBAdapter', () => {
  it('initializes Loki in incremental mode', () => {
    const adapter = new LokiIndexedDBAdapter();
    const db = new Loki('init.db', { adapter });
    const coll = db.addCollection('coll');
    expect(db.isIncremental).toBe(true);
    expect(coll.isIncremental).toBe(true);
    expect(adapter.chunkSize).toBe(100);
    expect(adapter.mode).toBe('incremental');
  });

  function checkDatabaseCopyIntegrity(source: any, copy: any) {
    source.collections.forEach((sourceCol: any, i: number) => {
      const copyCol = copy.collections[i];
      expect(copyCol.name).toBe(sourceCol.name);
      expect(copyCol.data.length).toBe(sourceCol.data.length);

      copyCol.data.forEach((copyEl: unknown, elIndex: number) => {
        expect(JSON.stringify(copyEl)).toBe(JSON.stringify(source.collections[i].data[elIndex]));
      });
    });
  }

  it('checkDatabaseCopyIntegrity works', () => {
    const db = new Loki('test.db');
    const col1 = db.addCollection<any>('test_collection');

    const doc1: any = { foo: '1' };
    const doc2: any = { foo: '2' };
    const doc3: any = { foo: '3' };
    col1.insert([doc1, doc2, doc3]);
    doc2.bar = 'true';
    col1.update(doc2);
    col1.remove(doc3);

    checkDatabaseCopyIntegrity(db, db);
    checkDatabaseCopyIntegrity(db, db.copy());
    checkDatabaseCopyIntegrity(db, JSON.parse(db.serialize()));
  });

  it('handles dirtyIds during save properly', async () => {
    const adapter = new LokiIndexedDBAdapter();
    const db = new Loki('test.db', { adapter });
    const col1 = db.addCollection<any>('test_collection');
    const col2 = db.addCollection<any>('test_collection2');
    col2.dirty = false;

    const doc1: any = { foo: '1' };
    const doc2: any = { foo: '2' };
    const doc3: any = { foo: '3' };
    col1.insert([doc1, doc2, doc3]);
    doc2.bar = 'true';
    col1.update(doc2);
    col1.remove(doc3);

    const dirty = col1.dirtyIds;
    expect(dirty.length).toBe(5);
    expect(col1.dirty).toBe(true);
    expect(col2.dirty).toBe(false);

    // simulate save - don't go through IDB, just check that logic is good
    let callCallback: any;
    (adapter as any).saveDatabase = (
      _dbname: string,
      getLokiCopy: () => unknown,
      callback: unknown,
    ) => {
      getLokiCopy();
      callCallback = callback;
    };

    // dirty ids zero out and roll back in case of error
    db.saveDatabase();
    expect(col1.dirtyIds).toEqual([]);
    expect(col1.dirty).toBe(false);
    callCallback(new Error('foo'));
    await flush();
    expect(col1.dirtyIds).toEqual(dirty);
    expect(col1.dirty).toBe(true);
    expect(col2.dirty).toBe(false);

    // new dirtied ids get added in case of rollback
    db.saveDatabase();
    const doc4: any = { foo: '4' };
    col1.insert(doc4);
    expect(col1.dirtyIds).toEqual([doc4.$loki]);
    const doc5: any = { foo: '5' };
    col2.insert(doc5);
    expect(col2.dirty).toBe(true);
    expect(col2.dirtyIds).toEqual([doc5.$loki]);
    callCallback(new Error('foo'));
    await flush();
    expect(col1.dirtyIds).toEqual([doc4.$loki].concat(dirty));
    expect(col1.dirty).toBe(true);
    expect(col2.dirtyIds).toEqual([doc5.$loki]);
    expect(col2.dirty).toBe(true);

    // if successful, dirty ids don't zero out
    db.saveDatabase();
    expect(col1.dirtyIds).toEqual([]);
    const doc6: any = { foo: '6' };
    col1.insert(doc6);
    expect(col1.dirtyIds).toEqual([doc6.$loki]);
    callCallback();
    await flush();
    expect(col1.dirtyIds).toEqual([doc6.$loki]);
  });

  it('saves, reloads into a new Loki and deletes', async () => {
    const name = uniqueName('roundtrip');
    const db = new Loki(name, { adapter: new LokiIndexedDBAdapter() });
    const users = db.addCollection<{ name: string }>('users');
    users.insert([{ name: 'odin' }, { name: 'thor' }]);
    await db.saveDatabase();
    users.insert({ name: 'loki' });
    await db.saveDatabase();

    const reloaded = await Loki.open(name, { adapter: new LokiIndexedDBAdapter() });
    expect(reloaded.getCollection('users')?.count()).toBe(3);
    expect(
      reloaded
        .getCollection<{ name: string }>('users')
        ?.find()
        .map((doc) => doc.name)
        .sort(),
    ).toEqual(['loki', 'odin', 'thor']);

    await reloaded.deleteDatabase();
    const afterDelete = await Loki.open(name, { adapter: new LokiIndexedDBAdapter() });
    expect(afterDelete.listCollections()).toEqual([]);
  });

  it('validates its options', () => {
    expect(() => new LokiIndexedDBAdapter({ megachunkCount: 5 })).toThrow(
      'megachunkCount must be >=4 and divisible by 2',
    );
    expect(() => new LokiIndexedDBAdapter({ serializeChunk: (_n, c) => c })).toThrow(
      'serializeChunk and deserializeChunk must be passed together',
    );
  });

  it('writes only the touched chunks on the next save', async () => {
    const name = uniqueName('incremental');
    const db = new Loki(name, { adapter: new LokiIndexedDBAdapter() });
    const users = db.addCollection<{ n: number }>('users');
    for (let n = 0; n < 250; n++) {
      users.insert({ n });
    }
    await db.saveDatabase();

    const put = vi.spyOn(IDBObjectStore.prototype, 'put');
    const doc = users.get(150)!;
    doc.n = -1;
    users.update(doc);
    await db.saveDatabase();
    expect(put.mock.calls.map(([record]) => (record as { key: string }).key)).toEqual([
      'users.chunk.1',
      'users.metadata',
      'loki',
    ]);
  });

  it('loads more than 100 chunks in order', async () => {
    const name = uniqueName('megachunks');
    const db = new Loki(name, { adapter: new LokiIndexedDBAdapter() });
    const users = db.addCollection<{ n: number }>('users');
    users.insert(Array.from({ length: 10_050 }, (_, n) => ({ n })));
    await db.saveDatabase();

    const reloaded = await Loki.open(name, { adapter: new LokiIndexedDBAdapter() });
    const data = reloaded.getCollection<{ n: number }>('users')!.data;
    expect(data).toHaveLength(10_050);
    expect(data.every((doc, i) => doc.$loki === i + 1 && doc.n === i)).toBe(true);
  });

  it('reloads a collection whose name contains a dot', async () => {
    const name = uniqueName('dots');
    const db = new Loki(name, { adapter: new LokiIndexedDBAdapter() });
    db.addCollection('users.v2').insert({ name: 'odin' });
    await db.saveDatabase();

    const reloaded = await Loki.open(name, { adapter: new LokiIndexedDBAdapter() });
    expect(reloaded.getCollection('users.v2')?.count()).toBe(1);
  });

  it('does not resurrect documents of a removed collection', async () => {
    const name = uniqueName('removed');
    const adapter = new LokiIndexedDBAdapter();
    const db = new Loki(name, { adapter });
    db.addCollection('users').insert(Array.from({ length: 300 }, (_, n) => ({ n })));
    await db.saveDatabase();
    db.removeCollection('users');
    await db.saveDatabase();
    db.addCollection('users').insert({ n: 'new' });
    await db.saveDatabase();

    const reloaded = await Loki.open(name, { adapter: new LokiIndexedDBAdapter() });
    expect(reloaded.getCollection('users')?.count()).toBe(1);
  });

  it('does not resurrect documents after clear()', async () => {
    const name = uniqueName('cleared');
    const db = new Loki(name, { adapter: new LokiIndexedDBAdapter() });
    const users = db.addCollection('users');
    users.insert(Array.from({ length: 250 }, (_, n) => ({ n })));
    await db.saveDatabase();
    users.clear();
    users.insert({ n: 'new' });
    await db.saveDatabase();

    const reloaded = await Loki.open(name, { adapter: new LokiIndexedDBAdapter() });
    expect(reloaded.getCollection('users')?.count()).toBe(1);
    expect(await rawGet(name, 'users.chunk.1')).toBeUndefined();
  });

  it('does not resurrect documents of a collection removed and recreated between two saves', async () => {
    const name = uniqueName('recreated');
    const db = new Loki(name, { adapter: new LokiIndexedDBAdapter() });
    db.addCollection('users').insert(Array.from({ length: 250 }, (_, n) => ({ n })));
    await db.saveDatabase();
    db.removeCollection('users');
    db.addCollection('users').insert({ n: 'new' });
    await db.saveDatabase();

    const reloaded = await Loki.open(name, { adapter: new LokiIndexedDBAdapter() });
    expect(reloaded.getCollection('users')?.count()).toBe(1);
  });

  it('keeps $loki unique after clear(), a reload and new inserts', async () => {
    const name = uniqueName('cleared-ids');
    const db = new Loki(name, { adapter: new LokiIndexedDBAdapter() });
    const users = db.addCollection<{ n: number | string }>('users');
    users.insert(Array.from({ length: 250 }, (_, n) => ({ n })));
    await db.saveDatabase();
    users.clear();
    users.insert({ n: 'new-0' });
    await db.saveDatabase();

    const reloaded = await Loki.open(name, { adapter: new LokiIndexedDBAdapter() });
    const again = reloaded.getCollection<{ n: number | string }>('users')!;
    again.insert(Array.from({ length: 150 }, (_, i) => ({ n: `new-${i + 1}` })));
    expect(again.count()).toBe(151);
    expect(again.get(120)?.n).toBe('new-119');
  });

  it('keeps the documents of a renamed collection', async () => {
    const name = uniqueName('renamed');
    const db = new Loki(name, { adapter: new LokiIndexedDBAdapter() });
    db.addCollection('users').insert([{ n: 1 }, { n: 2 }]);
    await db.saveDatabase();
    db.renameCollection('users', 'people');
    await db.saveDatabase();

    const reloaded = await Loki.open(name, { adapter: new LokiIndexedDBAdapter() });
    expect(reloaded.getCollection('people')?.count()).toBe(2);
    expect(reloaded.getCollection('users')).toBeNull();
    expect(await rawGet(name, 'users.chunk.0')).toBeUndefined();
  });

  it('does not mix documents when two collections swap names', async () => {
    const name = uniqueName('swapped');
    const db = new Loki(name, { adapter: new LokiIndexedDBAdapter() });
    db.addCollection('a').insert(Array.from({ length: 250 }, () => ({ from: 'a' })));
    const b = db.addCollection('b');
    b.insert(Array.from({ length: 250 }, () => ({ from: 'b' })));
    b.findAndRemove({ $loki: { $between: [100, 199] } });
    await db.saveDatabase();

    db.renameCollection('a', 'tmp');
    db.renameCollection('b', 'a');
    db.renameCollection('tmp', 'b');
    await db.saveDatabase();

    const reloaded = await Loki.open(name, { adapter: new LokiIndexedDBAdapter() });
    const froms = (coll: string) => [
      ...new Set(
        reloaded
          .getCollection(coll)!
          .find()
          .map((d) => d.from),
      ),
    ];
    expect(froms('a')).toEqual(['b']);
    expect(froms('b')).toEqual(['a']);
    expect(reloaded.getCollection('a')!.count()).toBe(150);
    expect(reloaded.getCollection('b')!.count()).toBe(250);
  });

  it('does not bring back a removed collection under a reused name', async () => {
    const name = uniqueName('reused');
    const db = new Loki(name, { adapter: new LokiIndexedDBAdapter() });
    db.addCollection('a').insert(Array.from({ length: 250 }, () => ({ from: 'a' })));
    const b = db.addCollection('b');
    b.insert(Array.from({ length: 250 }, () => ({ from: 'b' })));
    b.findAndRemove({ $loki: { $between: [100, 199] } });
    await db.saveDatabase();

    db.removeCollection('a');
    db.renameCollection('b', 'a');
    db.addCollection('b').insert(Array.from({ length: 250 }, () => ({ from: 'new' })));
    await db.saveDatabase();

    const reloaded = await Loki.open(name, { adapter: new LokiIndexedDBAdapter() });
    const froms = (coll: string) => [
      ...new Set(
        reloaded
          .getCollection(coll)!
          .find()
          .map((d) => d.from),
      ),
    ];
    expect(froms('a')).toEqual(['b']);
    expect(froms('b')).toEqual(['new']);
    expect(reloaded.getCollection('a')!.count()).toBe(150);
  });

  it('rewrites everything when another writer saved in between', async () => {
    const name = uniqueName('two-writers');
    const first = new Loki(name, { adapter: new LokiIndexedDBAdapter() });
    first.addCollection('users').insert(Array.from({ length: 250 }, (_, n) => ({ n })));
    await first.saveDatabase();

    const onDidOverwrite = vi.fn();
    const second = await Loki.open(name, { adapter: new LokiIndexedDBAdapter({ onDidOverwrite }) });
    const third = await Loki.open(name, { adapter: new LokiIndexedDBAdapter() });
    third.getCollection('users')!.insert({ n: 'third' });
    await third.saveDatabase();

    const users = second.getCollection('users')!;
    users.findAndRemove({ n: { $gte: 50 } });
    await second.saveDatabase();
    expect(onDidOverwrite).toHaveBeenCalledTimes(1);

    const reloaded = await Loki.open(name, { adapter: new LokiIndexedDBAdapter() });
    expect(reloaded.getCollection('users')?.count()).toBe(50);
    // the third writer's document ($loki 251) is overwritten: the full save rewrites every chunk up to maxId
    expect(JSON.parse((await rawGet(name, 'users.chunk.2'))!.value)).toEqual([]);
  });

  it('queues concurrent operations', async () => {
    const name = uniqueName('queue');
    const adapter = new LokiIndexedDBAdapter();
    const db = new Loki(name, { adapter });
    db.addCollection('users').insert({ n: 1 });
    const copy = () => db.copy({ removeNonSerializable: true });
    const [, loaded] = await Promise.all([
      adapter.saveDatabase(name, copy),
      adapter.loadDatabase(name),
      adapter.saveDatabase(name, copy),
    ]);
    expect(loaded).not.toBeNull();
    expect((loaded as { collections: { name: string }[] }).collections[0].name).toBe('users');
  });

  it('keeps databases of one adapter apart', async () => {
    const adapter = new LokiIndexedDBAdapter();
    const a = new Loki(uniqueName('apart-a'), { adapter });
    a.addCollection('a').insert({ n: 1 });
    await a.saveDatabase();
    const b = new Loki(uniqueName('apart-b'), { adapter });
    b.addCollection('b').insert({ n: 2 });
    await b.saveDatabase();

    const reloadedA = await Loki.open(a.filename, { adapter: new LokiIndexedDBAdapter() });
    expect(reloadedA.listCollections().map((c) => c.name)).toEqual(['a']);
  });

  it('writes everything on the first save, even documents loaded without dirty marks', async () => {
    const source = new Loki('source.db');
    source.addCollection('users').insert([{ n: 1 }, { n: 2 }, { n: 3 }]);
    const name = uniqueName('first-save');
    const db = new Loki(name, { adapter: new LokiIndexedDBAdapter() });
    db.loadJSON(source.serialize());
    await db.saveDatabase();

    const reloaded = await Loki.open(name, { adapter: new LokiIndexedDBAdapter() });
    expect(reloaded.getCollection('users')?.count()).toBe(3);
  });

  it('keeps the incremental path after deleting another database', async () => {
    const name = uniqueName('delete-other');
    const onDidOverwrite = vi.fn();
    const adapter = new LokiIndexedDBAdapter({ onDidOverwrite });
    const db = new Loki(name, { adapter });
    const users = db.addCollection<{ n: number }>('users');
    users.insert(Array.from({ length: 250 }, (_, n) => ({ n })));
    await db.saveDatabase();
    await adapter.deleteDatabase(uniqueName('other'));

    const put = vi.spyOn(IDBObjectStore.prototype, 'put');
    users.insert({ n: -1 });
    await db.saveDatabase();
    expect(put.mock.calls.map(([record]) => (record as { key: string }).key)).toEqual([
      'users.chunk.2',
      'users.metadata',
      'loki',
    ]);
    expect(onDidOverwrite).not.toHaveBeenCalled();
  });

  it('isolates exceptions thrown by user callbacks', async () => {
    const name = uniqueName('throwing-callbacks');
    const throwing = () => {
      throw new Error('user code');
    };
    const adapter = new LokiIndexedDBAdapter({
      onversionchange: throwing,
      onDidOverwrite: throwing,
    });
    const db = new Loki(name, { adapter });
    db.addCollection('users').insert({ n: 1 });
    const copy = () => db.copy({ removeNonSerializable: true });
    await adapter.saveDatabase(name, copy);
    const other = new LokiIndexedDBAdapter();
    await other.loadDatabase(name);
    await other.saveDatabase(name, copy);

    // Loki's save queue needs real timers: drive the adapters directly
    vi.useFakeTimers({ toFake: ['setTimeout'] });
    try {
      await adapter.saveDatabase(name, copy);
      expect(() => vi.runOnlyPendingTimers()).toThrow('user code');
      await other.deleteDatabase(name);
      expect(() => vi.runOnlyPendingTimers()).toThrow('user code');
    } finally {
      vi.useRealTimers();
    }
  });

  it('isolates an exception thrown by onFetchStart', async () => {
    const name = uniqueName('fetch-start');
    const db = new Loki(name, { adapter: new LokiIndexedDBAdapter() });
    db.addCollection('users').insert({ n: 1 });
    await db.saveDatabase();
    const adapter = new LokiIndexedDBAdapter({
      onFetchStart: () => {
        throw new Error('user code');
      },
    });
    vi.useFakeTimers({ toFake: ['setTimeout'] });
    try {
      await expect(adapter.loadDatabase(name)).resolves.toMatchObject({
        collections: [{ name: 'users' }],
      });
      expect(() => vi.runOnlyPendingTimers()).toThrow('user code');
    } finally {
      vi.useRealTimers();
    }
  });

  it('retries opening after a blocked open', async () => {
    const realOpen = indexedDB.open.bind(indexedDB);
    let calls = 0;
    vi.spyOn(indexedDB, 'open').mockImplementation((name: string, version?: number) => {
      calls++;
      if (calls === 1) {
        const request = {} as IDBOpenDBRequest;
        setTimeout(() => request.onblocked?.(new Event('blocked') as IDBVersionChangeEvent));
        return request;
      }
      return realOpen(name, version);
    });
    const adapter = new LokiIndexedDBAdapter();
    const name = uniqueName('blocked');
    await expect(adapter.loadDatabase(name)).rejects.toMatchObject({ code: 'EBUSY' });
    await expect(adapter.loadDatabase(name)).resolves.toBeNull();
  });

  it('rejects a database without the Loki store', async () => {
    const name = uniqueName('foreign');
    await new Promise<void>((resolve) => {
      const req = indexedDB.open(name, 1);
      req.onupgradeneeded = () => req.result.createObjectStore('other');
      req.onsuccess = () => {
        req.result.close();
        resolve();
      };
    });
    await expect(new LokiIndexedDBAdapter().loadDatabase(name)).rejects.toThrow(
      'Missing LokiIncrementalData',
    );
  });

  it('reports a full storage with EQUOTA and keeps the collection dirty', async () => {
    const name = uniqueName('quota');
    const db = new Loki(name, { adapter: new LokiIndexedDBAdapter() });
    const users = db.addCollection('users');
    users.insert({ n: 1 });
    vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(() => {
      throw new DOMException('full', 'QuotaExceededError');
    });
    await expect(db.saveDatabase()).rejects.toMatchObject({ code: 'EQUOTA' });
    expect(users.dirty).toBe(true);
    expect(users.dirtyIds).toEqual([1]);
  });

  it('reports a missing IndexedDB with ENOTSUP', async () => {
    vi.stubGlobal('indexedDB', undefined);
    await expect(new LokiIndexedDBAdapter().loadDatabase('x.db')).rejects.toMatchObject({
      code: 'ENOTSUP',
    });
    await expect(LokiIndexedDBAdapter.isSupported()).resolves.toBe(false);
  });

  it('is supported where IndexedDB is', async () => {
    await expect(LokiIndexedDBAdapter.isSupported()).resolves.toBe(true);
  });

  it('closes on versionchange and reopens for the next save', async () => {
    const name = uniqueName('versionchange');
    const onversionchange = vi.fn();
    const db = new Loki(name, { adapter: new LokiIndexedDBAdapter({ onversionchange }) });
    db.addCollection('users').insert(Array.from({ length: 250 }, (_, n) => ({ n })));
    await db.saveDatabase();

    await new LokiIndexedDBAdapter().deleteDatabase(name);
    expect(onversionchange).toHaveBeenCalledTimes(1);

    // only one chunk is dirty, but the database is gone: everything must be rewritten
    db.getCollection('users')!.insert({ n: -1 });
    await db.saveDatabase();
    const reloaded = await Loki.open(name, { adapter: new LokiIndexedDBAdapter() });
    expect(reloaded.getCollection('users')?.count()).toBe(251);
  });

  function captureConnections(): IDBDatabase[] {
    const connections: IDBDatabase[] = [];
    const realOpen = indexedDB.open.bind(indexedDB);
    vi.spyOn(indexedDB, 'open').mockImplementation((name: string, version?: number) => {
      const request = realOpen(name, version);
      request.addEventListener('success', () => connections.push(request.result));
      return request;
    });
    return connections;
  }

  it('reopens after the browser closed the connection (onclose)', async () => {
    const connections = captureConnections();
    const name = uniqueName('onclose');
    const db = new Loki(name, { adapter: new LokiIndexedDBAdapter() });
    const users = db.addCollection('users');
    users.insert({ n: 1 });
    await db.saveDatabase();
    expect(connections).toHaveLength(1);
    const [lost] = connections;
    lost.close();
    lost.onclose?.call(lost, new Event('close'));
    const transaction = vi.spyOn(lost, 'transaction');

    users.insert({ n: 2 });
    await db.saveDatabase();
    expect(transaction).not.toHaveBeenCalled();
    expect(connections).toHaveLength(2);
    const reloaded = await Loki.open(name, { adapter: new LokiIndexedDBAdapter() });
    expect(reloaded.getCollection('users')?.count()).toBe(2);
  });

  it('reopens once when the connection turns out to be closed', async () => {
    const connections = captureConnections();
    const name = uniqueName('closed');
    const adapter = new LokiIndexedDBAdapter();
    const db = new Loki(name, { adapter });
    const users = db.addCollection('users');
    users.insert({ n: 1 });
    await db.saveDatabase();
    // closed without onclose, as when it fires after the next operation started
    connections[0].close();
    users.insert({ n: 2 });
    await db.saveDatabase();
    connections[1].close();
    expect(await adapter.loadDatabase(name)).toMatchObject({ collections: [{ name: 'users' }] });
    expect(connections).toHaveLength(3);
  });

  it('deserializes lazy collections on first access', async () => {
    const name = uniqueName('lazy');
    const db = new Loki(name, { adapter: new LokiIndexedDBAdapter() });
    db.addCollection('logs').insert([{ n: 1 }, { n: 2 }]);
    await db.saveDatabase();

    const reloaded = await Loki.open(name, {
      adapter: new LokiIndexedDBAdapter({ lazyCollections: ['logs'] }),
    });
    expect(reloaded.getCollection('logs')?.count()).toBe(2);
  });

  it('round-trips through serializeChunk and deserializeChunk', async () => {
    const name = uniqueName('serialize');
    const options = {
      serializeChunk: (_name: string, chunk: object[]) => chunk.map((doc) => JSON.stringify(doc)),
      deserializeChunk: (_name: string, chunk: string[]) => chunk.map((doc) => JSON.parse(doc)),
    };
    const db = new Loki(name, { adapter: new LokiIndexedDBAdapter(options) });
    db.addCollection('users').insert({ name: 'odin' });
    await db.saveDatabase();
    expect(JSON.parse((await rawGet(name, 'users.chunk.0'))!.value)[0]).toBeTypeOf('string');

    const reloaded = await Loki.open(name, { adapter: new LokiIndexedDBAdapter(options) });
    expect(reloaded.getCollection('users')?.findOne({ name: 'odin' })).toBeTruthy();
  });
});
