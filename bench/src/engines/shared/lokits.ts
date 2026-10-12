import { Loki } from '@lokits/core';
import type { MemoryEngine } from '../../core/engine.ts';
import { LOKI_COLLECTION_OPTIONS, type LokiStyleCollection, lokiStyleDb } from './loki-style.ts';

export const lokits: MemoryEngine = {
  name: 'LokiTS',
  packageName: '@lokits/core',
  envs: ['node', 'browser'],
  sync: true,
  notes:
    'Default options (no cloning). Unique indexes on id and email (lookups with by()), binary index on age, DynamicView for the live query.',
  create() {
    const db = new Loki('bench');
    const coll = db.addCollection('docs', LOKI_COLLECTION_OPTIONS);
    return lokiStyleDb(coll as unknown as LokiStyleCollection);
  },
};
