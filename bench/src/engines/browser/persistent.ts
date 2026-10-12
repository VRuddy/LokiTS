import { Loki, LokiIndexedDBAdapter, LokiOpfsAdapter, LokiPartitioningAdapter } from '@lokits/core';
import Dexie, { type Table } from 'dexie';
import Lokijs from 'lokijs';
import IncrementalIndexedDBAdapter from 'lokijs/src/incremental-indexeddb-adapter.js';
import { createIndexes, createStore, type Row } from 'tinybase';
import { createIndexedDbPersister } from 'tinybase/persisters/persister-indexed-db';
import type { BenchDoc } from '../../core/data.ts';
import type { PersistentDb, PersistentEngine } from '../../core/engine.ts';
import { LOKI_COLLECTION_OPTIONS, type LokiStyleCollection } from '../shared/loki-style.ts';

const FILE = 'bench.db';

function lokiCollectionDb(
  coll: LokiStyleCollection,
  persist: () => Promise<void>,
  close: () => Promise<void>,
): PersistentDb {
  return {
    insertMany(docs) {
      coll.insert(docs);
    },
    updateScores(ids, score) {
      for (const id of ids) {
        const doc = coll.by('id', id) as BenchDoc;
        doc.score = score;
        coll.update(doc);
      }
    },
    findEq(_field, value) {
      const doc = coll.by('email', value);
      return doc ? [doc.id] : [];
    },
    persist,
    close,
  };
}

const deleteIdb = (name: string) =>
  new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase(name);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });

async function removeOpfsDirectory(name: string): Promise<void> {
  const root = await navigator.storage.getDirectory();
  await root.removeEntry(name, { recursive: true }).catch(() => undefined);
}

async function openLokits(
  filename: string,
  adapter: LokiPartitioningAdapter | LokiIndexedDBAdapter,
): Promise<PersistentDb> {
  const db = await Loki.open(filename, { adapter });
  const coll = db.getCollection('docs') ?? db.addCollection('docs', LOKI_COLLECTION_OPTIONS);
  return lokiCollectionDb(
    coll as unknown as LokiStyleCollection,
    () => db.saveDatabase(),
    () => db.close(),
  );
}

const LOKITS_NOTES =
  'Same collection setup as in memory; Loki.open, then saveDatabase() per write.';

export const lokitsOpfs: PersistentEngine = {
  name: 'LokiTS',
  packageName: '@lokits/core',
  envs: ['browser'],
  sync: true,
  storage: 'opfs',
  durability: 'one file per collection, atomically replaced files',
  notes: `${LOKITS_NOTES} LokiPartitioningAdapter over LokiOpfsAdapter, as the README recommends.`,
  open: (location) =>
    openLokits(FILE, new LokiPartitioningAdapter(new LokiOpfsAdapter({ directory: location }))),
  destroy: removeOpfsDirectory,
};

export const lokitsIndexedDB: PersistentEngine = {
  name: 'LokiTS',
  packageName: '@lokits/core',
  envs: ['browser'],
  sync: true,
  storage: 'indexeddb',
  durability: 'one IndexedDB transaction per save, changed chunks only',
  notes: `${LOKITS_NOTES} LokiIndexedDBAdapter.`,
  open: (location) => openLokits(location, new LokiIndexedDBAdapter()),
  destroy: (location) => new LokiIndexedDBAdapter().deleteDatabase(location),
};

// lokijs adapters answer either an error or a { success } result
const failed = (result: unknown) =>
  result instanceof Error ||
  (typeof result === 'object' &&
    result !== null &&
    (result as { success?: boolean }).success === false);

const callback = (run: (done: (result?: unknown) => void) => void) =>
  new Promise<void>((resolve, reject) =>
    run((result) => (failed(result) ? reject(result) : resolve())),
  );

export const lokijsIndexedDB: PersistentEngine = {
  name: 'lokijs',
  packageName: 'lokijs',
  envs: ['browser'],
  sync: true,
  storage: 'indexeddb',
  durability: 'incremental IndexedDB adapter',
  notes: 'IncrementalIndexedDBAdapter, same collection setup as LokiTS.',
  async open(location) {
    const db = new Lokijs(location, { adapter: new IncrementalIndexedDBAdapter() });
    await callback((done) => db.loadDatabase({}, done));
    const coll = db.getCollection('docs') ?? db.addCollection('docs', LOKI_COLLECTION_OPTIONS);
    return lokiCollectionDb(
      coll,
      () => callback((done) => db.saveDatabase(done)),
      () => callback((done) => db.close(done)),
    );
  },
  async destroy(location) {
    await callback((done) => new IncrementalIndexedDBAdapter().deleteDatabase(location, done));
  },
};

type DexieDb = Dexie & { docs: Table<BenchDoc, number> };

export const dexieIndexedDB: PersistentEngine = {
  name: 'Dexie',
  packageName: 'dexie',
  envs: ['browser'],
  sync: false,
  storage: 'indexeddb',
  durability: 'IndexedDB with the browser default durability',
  notes:
    'Primary key id, unique index on email, index on age; bulkAdd and bulkUpdate (one transaction each). Writes are persisted when they resolve.',
  async open(location) {
    const db = new Dexie(location) as DexieDb;
    db.version(1).stores({ docs: 'id, &email, age' });
    await db.open();
    return {
      async insertMany(docs) {
        await db.docs.bulkAdd(docs);
      },
      async updateScores(ids, score) {
        await db.docs.bulkUpdate(ids.map((key) => ({ key, changes: { score } })));
      },
      async findEq(_field, value) {
        return (await db.docs.where('email').equals(value).toArray()).map((d) => d.id);
      },
      persist: async () => {},
      close: async () => db.close(),
    };
  },
  destroy: (location) => Dexie.delete(location),
};

export const tinybaseIndexedDB: PersistentEngine = {
  name: 'TinyBase',
  packageName: 'tinybase',
  envs: ['browser'],
  sync: true,
  storage: 'indexeddb',
  durability: 'IndexedDB persister',
  notes: 'IndexedDB persister, explicit save() per write; email index rebuilt on open.',
  async open(location) {
    const store = createStore();
    const persister = createIndexedDbPersister(store, location);
    await persister.load();
    const indexes = createIndexes(store);
    indexes.setIndexDefinition('email', 'docs', 'email');
    return {
      insertMany(docs) {
        store.transaction(() => {
          for (const doc of docs) {
            store.setRow('docs', String(doc.id), doc as unknown as Row);
          }
        });
      },
      updateScores(ids, score) {
        store.transaction(() => {
          for (const id of ids) {
            store.setCell('docs', String(id), 'score', score);
          }
        });
      },
      findEq: (_field, value) => indexes.getSliceRowIds('email', value).map(Number),
      persist: () => persister.save().then(() => undefined),
      async close() {
        indexes.destroy();
        await persister.destroy();
      },
    };
  },
  destroy: deleteIdb,
};

interface Pending {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
}

function workerClient() {
  const worker = new Worker(new URL('./sqlite-wasm.worker.ts', import.meta.url), {
    type: 'module',
  });
  let next = 0;
  const pending = new Map<number, Pending>();
  worker.onmessage = (event: MessageEvent<{ id: number; result?: unknown; error?: string }>) => {
    const entry = pending.get(event.data.id);
    pending.delete(event.data.id);
    if (event.data.error !== undefined) {
      entry?.reject(new Error(event.data.error));
    } else {
      entry?.resolve(event.data.result);
    }
  };
  return (op: string, ...args: unknown[]) =>
    new Promise<unknown>((resolve, reject) => {
      const id = next++;
      pending.set(id, { resolve, reject });
      worker.postMessage({ id, op, args });
    });
}

let call: ReturnType<typeof workerClient> | undefined;
const sqliteCall = (op: string, ...args: unknown[]) => {
  call ??= workerClient();
  return call(op, ...args);
};

export const sqliteWasmOpfs: PersistentEngine = {
  name: 'SQLite',
  packageName: '@sqlite.org/sqlite-wasm',
  envs: ['browser'],
  sync: false,
  storage: 'opfs',
  durability: 'OPFS SAH pool VFS in a Worker, synchronous=FULL',
  notes:
    'Official WASM build in a dedicated Worker (OPFS needs one); every call crosses postMessage, as it would in an app.',
  async open(location) {
    await sqliteCall('open', `/${location}.sqlite`);
    return {
      insertMany: (docs) => sqliteCall('insertMany', docs).then(() => undefined),
      updateScores: (ids, score) => sqliteCall('updateScores', ids, score).then(() => undefined),
      findEq: (_field, value) => sqliteCall('findEq', value) as Promise<number[]>,
      persist: async () => {},
      close: () => sqliteCall('close').then(() => undefined),
    };
  },
  destroy: (location) => sqliteCall('destroy', `/${location}.sqlite`).then(() => undefined),
};
