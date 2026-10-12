import { existsSync } from 'node:fs';
import { mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import FsStorageModule from '@lokidb/fs-storage';
import LokiModule from '@lokidb/loki';
import { Loki, LokiFsAdapter, LokiFsStructuredAdapter } from '@lokits/core';
import Lokijs from 'lokijs';
import { createIndexes, createStore, type Row } from 'tinybase';
import { createFilePersister } from 'tinybase/persisters/persister-file';
import type { BenchDoc } from '../../core/data.ts';
import type { PersistentDb, PersistentEngine } from '../../core/engine.ts';
import { LOKI_COLLECTION_OPTIONS, type LokiStyleCollection } from '../shared/loki-style.ts';
import { SCHEMA_SQL, sqlInsertMany, sqlUpdateScores } from '../shared/sql.ts';
import { nodeSqlDriver } from './sqlite.ts';

const FILE = 'bench.db';
// webpack bundles: Node's native ESM loader and Vite expose them at different depths
const LokiDB = (LokiModule as unknown as { default?: typeof LokiModule }).default ?? LokiModule;
const FSStorage =
  (FsStorageModule as unknown as { FSStorage?: typeof FsStorageModule }).FSStorage ??
  FsStorageModule;

async function resetDir(dir: string): Promise<void> {
  await rm(dir, { recursive: true, force: true });
  await mkdir(dir, { recursive: true });
}

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

function lokitsEngine(
  storage: string,
  makeAdapter: () => LokiFsAdapter | LokiFsStructuredAdapter,
  durability: string,
): PersistentEngine {
  return {
    name: 'LokiTS',
    packageName: '@lokits/core',
    envs: ['node'],
    sync: true,
    storage,
    durability,
    notes: 'Same collection setup as in memory; Loki.open, then saveDatabase() per write.',
    async open(dir) {
      const db = await Loki.open(join(dir, FILE), { adapter: makeAdapter() });
      const coll = db.getCollection('docs') ?? db.addCollection('docs', LOKI_COLLECTION_OPTIONS);
      return lokiCollectionDb(
        coll as unknown as LokiStyleCollection,
        () => db.saveDatabase(),
        () => db.close(),
      );
    },
    destroy: resetDir,
  };
}

export const lokitsFs = lokitsEngine('fs', () => new LokiFsAdapter(), 'atomic replace with fsync');
export const lokitsFsStructured = lokitsEngine(
  'fs-structured',
  () => new LokiFsStructuredAdapter(),
  'one file per collection, atomic generations with fsync',
);

const callback = (run: (done: (err?: unknown) => void) => void) =>
  new Promise<void>((resolve, reject) => run((err) => (err ? reject(err) : resolve())));

export const lokijsFs: PersistentEngine = {
  name: 'lokijs',
  packageName: 'lokijs',
  envs: ['node'],
  sync: true,
  storage: 'fs',
  durability: 'file overwritten in place, no fsync',
  notes: 'Default LokiFsAdapter, same collection setup as LokiTS.',
  async open(dir) {
    const db = new Lokijs(join(dir, FILE), { adapter: new Lokijs.LokiFsAdapter() });
    await callback((done) => db.loadDatabase({}, done));
    const coll = db.getCollection('docs') ?? db.addCollection('docs', LOKI_COLLECTION_OPTIONS);
    return lokiCollectionDb(
      coll,
      () => callback((done) => db.saveDatabase(done)),
      () => callback((done) => db.close(done)),
    );
  },
  destroy: resetDir,
};

export const lokidbFs: PersistentEngine = {
  name: 'LokiDB',
  packageName: '@lokidb/loki',
  envs: ['node'],
  sync: true,
  storage: 'fs',
  durability: 'temporary file then rename, no fsync',
  notes:
    '@lokidb/fs-storage, unique indexes on id and email. No age index: LokiDB 2.1.0 loses the comparator of a ranged index on reload (restore() reads a function from JSON), so it does less index work on writes than the others.',
  async open(dir) {
    const path = join(dir, FILE);
    const db = new LokiDB(path);
    await db.initializePersistence({ adapter: new FSStorage() });
    if (existsSync(path)) {
      await db.loadDatabase();
    }
    const coll =
      db.getCollection('docs') ?? db.addCollection<BenchDoc>('docs', { unique: ['id', 'email'] });
    return lokiCollectionDb(
      coll as unknown as LokiStyleCollection,
      () => db.saveDatabase(),
      () => db.close(),
    );
  },
  destroy: resetDir,
};

export const tinybaseFile: PersistentEngine = {
  name: 'TinyBase',
  packageName: 'tinybase',
  envs: ['node'],
  sync: true,
  storage: 'file',
  durability: 'temporary file then rename, no fsync',
  notes: 'File persister, explicit save() per write; email index rebuilt on open.',
  async open(dir) {
    const store = createStore();
    const persister = createFilePersister(store, join(dir, 'bench.json'));
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
  destroy: resetDir,
};

export const sqliteFile: PersistentEngine = {
  name: 'SQLite',
  packageName: 'node:sqlite',
  envs: ['node'],
  sync: true,
  storage: 'file',
  durability: 'WAL, synchronous=FULL (fsync on commit)',
  notes: 'node:sqlite, one transaction per write (committed = persisted, persist() is a no-op).',
  async open(dir) {
    const driver = nodeSqlDriver(join(dir, 'bench.sqlite'));
    driver.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = FULL;');
    driver.exec(SCHEMA_SQL);
    return {
      insertMany: (docs) => sqlInsertMany(driver, docs),
      updateScores: (ids, score) => sqlUpdateScores(driver, ids, score),
      findEq: (_field, value) =>
        driver.all('SELECT * FROM docs WHERE email = ?', [value]).map((r) => Number(r.id)),
      persist: async () => {},
      close: async () => driver.close(),
    };
  },
  destroy: resetDir,
};
