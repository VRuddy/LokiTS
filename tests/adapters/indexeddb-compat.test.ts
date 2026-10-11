import 'fake-indexeddb/auto';
import { createRequire } from 'node:module';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Loki, LokiIndexedDBAdapter } from '../../src';

const require = createRequire(import.meta.url);
const LegacyLoki = require('lokijs');

const LegacyIncremental = require('lokijs/src/incremental-indexeddb-adapter.js');

afterEach(() => {
  vi.restoreAllMocks();
});

const legacySave = (db: any) =>
  new Promise<void>((resolve, reject) =>
    db.saveDatabase((err: unknown) => (err ? reject(err) : resolve())),
  );
const legacyLoad = (db: any) =>
  new Promise<void>((resolve, reject) =>
    db.loadDatabase({}, (err: unknown) => (err ? reject(err) : resolve())),
  );
const legacyOpen = async (name: string) => {
  const db = new LegacyLoki(name, { adapter: new LegacyIncremental() });
  await legacyLoad(db);
  return db;
};

function blockFirstOpen() {
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
}

function failDelete(error: DOMException) {
  vi.spyOn(indexedDB, 'deleteDatabase').mockImplementation(() => {
    const request = { error } as unknown as IDBOpenDBRequest;
    setTimeout(() => request.onerror?.(new Event('error')));
    return request;
  });
}

describe('IndexedDB compatibility with lokijs 1.5.12', () => {
  it('reads a database written by the lokijs incremental adapter', async () => {
    const legacy = new LegacyLoki('from-lokijs.db', { adapter: new LegacyIncremental() });
    const users = legacy.addCollection('users', { indices: ['n'] });
    for (let n = 0; n < 250; n++) {
      users.insert({ n });
    }
    users.remove(users.get(10));
    await legacySave(legacy);

    const db = await Loki.open('from-lokijs.db', { adapter: new LokiIndexedDBAdapter() });
    const reloaded = db.getCollection<{ n: number }>('users')!;
    expect(reloaded.count()).toBe(249);
    expect(reloaded.findOne({ n: 200 })?.$loki).toBe(201);
  });

  it('writes a database the lokijs incremental adapter reads', async () => {
    const db = new Loki('to-lokijs.db', { adapter: new LokiIndexedDBAdapter() });
    db.addCollection('users').insert(Array.from({ length: 150 }, (_, n) => ({ n })));
    await db.saveDatabase();
    db.getCollection('users')!.insert({ n: 'more' });
    await db.saveDatabase();

    const legacy = new LegacyLoki('to-lokijs.db', { adapter: new LegacyIncremental() });
    await legacyLoad(legacy);
    expect(legacy.getCollection('users').count()).toBe(151);
  });

  it('shows the dotted-name bug on lokijs and not on LokiTS', async () => {
    // the lokijs adapter logs "Unknown chunk" before throwing
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const legacy = new LegacyLoki('dots-lokijs.db', { adapter: new LegacyIncremental() });
    legacy.addCollection('users.v2').insert({ n: 1 });
    await legacySave(legacy);
    const reloadedLegacy = new LegacyLoki('dots-lokijs.db', { adapter: new LegacyIncremental() });
    await expect(legacyLoad(reloadedLegacy)).rejects.toThrow('Corrupted database');

    const db = await Loki.open('dots-lokijs.db', { adapter: new LokiIndexedDBAdapter() });
    expect(db.getCollection('users.v2')?.count()).toBe(1);
  });
  it('shows the removed-collection bug on lokijs and not on LokiTS', async () => {
    const scenario = async (db: any, save: () => Promise<void>) => {
      db.addCollection('users').insert(Array.from({ length: 300 }, (_, n) => ({ n })));
      await save();
      db.removeCollection('users');
      await save();
      db.addCollection('users').insert({ n: 'new' });
      await save();
    };
    const legacy = new LegacyLoki('removed-lokijs.db', { adapter: new LegacyIncremental() });
    await scenario(legacy, () => legacySave(legacy));
    // chunks 1 and 2 of the removed collection come back
    expect((await legacyOpen('removed-lokijs.db')).getCollection('users').count()).toBe(202);

    const ours = new Loki('removed-lokits.db', { adapter: new LokiIndexedDBAdapter() });
    await scenario(ours, () => ours.saveDatabase());
    const db = await Loki.open('removed-lokits.db', { adapter: new LokiIndexedDBAdapter() });
    expect(db.getCollection('users')?.count()).toBe(1);
  });

  it('shows the cleared-collection bug on lokijs and not on LokiTS', async () => {
    const scenario = async (db: any, save: () => Promise<void>) => {
      const users = db.addCollection('users');
      users.insert(Array.from({ length: 250 }, (_, n) => ({ n })));
      await save();
      users.clear();
      users.insert({ n: 'new' });
      await save();
    };
    const legacy = new LegacyLoki('cleared-lokijs.db', { adapter: new LegacyIncremental() });
    await scenario(legacy, () => legacySave(legacy));
    // chunks 1 and 2 written before clear() come back
    expect((await legacyOpen('cleared-lokijs.db')).getCollection('users').count()).toBe(152);

    const ours = new Loki('cleared-lokits.db', { adapter: new LokiIndexedDBAdapter() });
    await scenario(ours, () => ours.saveDatabase());
    const db = await Loki.open('cleared-lokits.db', { adapter: new LokiIndexedDBAdapter() });
    expect(db.getCollection('users')?.count()).toBe(1);
  });

  it('shows the renamed-collection bug on lokijs and not on LokiTS', async () => {
    const legacy = new LegacyLoki('renamed-lokijs.db', { adapter: new LegacyIncremental() });
    legacy.addCollection('users').insert([{ n: 1 }, { n: 2 }]);
    await legacySave(legacy);
    legacy.renameCollection('users', 'people');
    await legacySave(legacy);
    // the renamed collection has no metadata chunk: the database no longer loads
    await expect(legacyOpen('renamed-lokijs.db')).rejects.toThrow(TypeError);

    const ours = new Loki('renamed-lokits.db', { adapter: new LokiIndexedDBAdapter() });
    ours.addCollection('users').insert([{ n: 1 }, { n: 2 }]);
    await ours.saveDatabase();
    ours.renameCollection('users', 'people');
    await ours.saveDatabase();
    const db = await Loki.open('renamed-lokits.db', { adapter: new LokiIndexedDBAdapter() });
    expect(db.getCollection('people')?.count()).toBe(2);
  });

  it('shows the first-save bug on lokijs and not on LokiTS', async () => {
    const source = new Loki('source.db');
    source.addCollection('users').insert([{ n: 1 }, { n: 2 }, { n: 3 }]);

    const legacy = new LegacyLoki('first-save-lokijs.db', { adapter: new LegacyIncremental() });
    legacy.loadJSON(source.serialize());
    await legacySave(legacy);
    // nothing was dirty: only the database record was written, without the collection's chunks
    await expect(legacyOpen('first-save-lokijs.db')).rejects.toThrow(TypeError);

    const ours = new Loki('first-save-lokits.db', { adapter: new LokiIndexedDBAdapter() });
    ours.loadJSON(source.serialize());
    await ours.saveDatabase();
    const db = await Loki.open('first-save-lokits.db', { adapter: new LokiIndexedDBAdapter() });
    expect(db.getCollection('users')?.count()).toBe(3);
  });

  it('shows the blocked-open bug on lokijs and not on LokiTS', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    blockFirstOpen();
    const legacy = new LegacyIncremental();
    const first = await new Promise((resolve) => legacy.loadDatabase('blocked-lokijs.db', resolve));
    expect(String(first)).toContain('blocked');
    expect(() => legacy.loadDatabase('blocked-lokijs.db', () => {})).toThrow(
      'open is already in progress',
    );

    vi.restoreAllMocks();
    blockFirstOpen();
    const ours = new LokiIndexedDBAdapter();
    await expect(ours.loadDatabase('blocked-lokits.db')).rejects.toMatchObject({ code: 'EBUSY' });
    await expect(ours.loadDatabase('blocked-lokits.db')).resolves.toBeNull();
  });

  it('shows the two-databases bug on lokijs and not on LokiTS', async () => {
    const legacyAdapter = new LegacyIncremental();
    const a = new LegacyLoki('apart-a-lokijs.db', { adapter: legacyAdapter });
    a.addCollection('a').insert({ n: 1 });
    await legacySave(a);
    const b = new LegacyLoki('apart-b-lokijs.db', { adapter: legacyAdapter });
    b.addCollection('b').insert({ n: 2 });
    await legacySave(b);
    // b was written into a's IndexedDB database
    const names = (db: any) => db.listCollections().map((c: { name: string }) => c.name);
    expect(names(await legacyOpen('apart-a-lokijs.db'))).toEqual(['b']);
    expect(names(await legacyOpen('apart-b-lokijs.db'))).toEqual([]);

    const adapter = new LokiIndexedDBAdapter();
    const ourA = new Loki('apart-a-lokits.db', { adapter });
    ourA.addCollection('a').insert({ n: 1 });
    await ourA.saveDatabase();
    const ourB = new Loki('apart-b-lokits.db', { adapter });
    ourB.addCollection('b').insert({ n: 2 });
    await ourB.saveDatabase();
    const open = (name: string) => Loki.open(name, { adapter: new LokiIndexedDBAdapter() });
    expect(names(await open('apart-a-lokits.db'))).toEqual(['a']);
    expect(names(await open('apart-b-lokits.db'))).toEqual(['b']);
  });

  it('shows the concurrent-operations bug on lokijs and not on LokiTS', async () => {
    const legacy = new LegacyIncremental();
    await new Promise((resolve) => legacy.loadDatabase('concurrent-lokijs.db', resolve));
    const saved = new Promise((resolve) =>
      legacy.saveDatabase('concurrent-lokijs.db', () => ({ collections: [] }), resolve),
    );
    expect(() => legacy.loadDatabase('concurrent-lokijs.db', () => {})).toThrow(
      'another operation is already in progress',
    );
    await saved;

    const ours = new LokiIndexedDBAdapter();
    await ours.loadDatabase('concurrent-lokits.db');
    await expect(
      Promise.all([
        ours.saveDatabase('concurrent-lokits.db', () => ({ collections: [] })),
        ours.loadDatabase('concurrent-lokits.db'),
      ]),
    ).resolves.toEqual([undefined, expect.objectContaining({ collections: [] })]);
  });

  it('shows the failed-delete bug on lokijs and not on LokiTS', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const error = new DOMException('disk failure', 'UnknownError');
    failDelete(error);
    const legacy = new LegacyIncremental();
    // the error is lost: callers checking for a truthy error see a success
    const outcome = await new Promise((resolve) =>
      legacy.deleteDatabase('delete-lokijs.db', resolve),
    );
    expect(outcome).toEqual({ success: false });

    const ours = new LokiIndexedDBAdapter();
    await expect(ours.deleteDatabase('delete-lokits.db')).rejects.toBe(error);
    const callback = vi.fn();
    await ours.deleteDatabase('delete-lokits.db', callback);
    expect(callback).toHaveBeenCalledWith(error);
  });
});
