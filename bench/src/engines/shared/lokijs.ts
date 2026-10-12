import Loki from 'lokijs';
import type { MemoryEngine } from '../../core/engine.ts';
import { LOKI_COLLECTION_OPTIONS, type LokiStyleCollection, lokiStyleDb } from './loki-style.ts';

export const lokijs: MemoryEngine = {
  name: 'lokijs',
  packageName: 'lokijs',
  envs: ['node', 'browser'],
  sync: true,
  notes:
    'Same configuration as LokiTS: default options, unique indexes on id and email, binary index on age.',
  create() {
    const db = new Loki('bench');
    const coll = db.addCollection('docs', LOKI_COLLECTION_OPTIONS);
    return lokiStyleDb(coll as LokiStyleCollection);
  },
};
