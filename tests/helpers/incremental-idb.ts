import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

export const IncrementalIndexedDBAdapter: any = require('../../src/incremental-indexeddb-adapter.js');
