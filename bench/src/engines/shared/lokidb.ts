import LokiModule from '@lokidb/loki';
import type { MemoryEngine } from '../../core/engine.ts';
import { type LokiStyleCollection, lokiStyleDb } from './loki-style.ts';

// the webpack bundle nests the class one level deeper under Node's native ESM loader than under Vite
const LokiDB = (LokiModule as unknown as { default?: typeof LokiModule }).default ?? LokiModule;

export const LOKIDB_COLLECTION_OPTIONS = {
  unique: ['id', 'email'],
  rangedIndexes: { age: {} },
};

export const lokidb: MemoryEngine = {
  name: 'LokiDB',
  packageName: '@lokidb/loki',
  envs: ['node', 'browser'],
  sync: true,
  notes:
    'Default options. Unique indexes on id and email (lookups with by()), ranged index on age, DynamicView for the live query. Unmaintained since 2022.',
  create() {
    const db = new LokiDB('bench');
    const coll = db.addCollection('docs', LOKIDB_COLLECTION_OPTIONS);
    return lokiStyleDb(coll as unknown as LokiStyleCollection);
  },
};
