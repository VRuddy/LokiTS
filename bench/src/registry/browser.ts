import type { MemoryEngine, PersistentEngine } from '../core/engine.ts';

const persistent = () => import('../engines/browser/persistent.ts');

export const BROWSER_MEMORY_ENGINES: Record<string, () => Promise<MemoryEngine>> = {
  lokits: async () => (await import('../engines/shared/lokits.ts')).lokits,
  lokijs: async () => (await import('../engines/shared/lokijs.ts')).lokijs,
  lokidb: async () => (await import('../engines/shared/lokidb.ts')).lokidb,
  tinybase: async () => (await import('../engines/shared/tinybase.ts')).tinybase,
  'rxdb-memory': async () => (await import('../engines/shared/rxdb.ts')).rxdbMemory,
  sqlite: async () => (await import('../engines/browser/sqlite-wasm.ts')).sqliteWasm,
};

export const BROWSER_PERSISTENT_ENGINES: Record<string, () => Promise<PersistentEngine>> = {
  'lokits-opfs': async () => (await persistent()).lokitsOpfs,
  'lokits-indexeddb': async () => (await persistent()).lokitsIndexedDB,
  'lokijs-indexeddb': async () => (await persistent()).lokijsIndexedDB,
  'dexie-indexeddb': async () => (await persistent()).dexieIndexedDB,
  'tinybase-indexeddb': async () => (await persistent()).tinybaseIndexedDB,
  'sqlite-opfs': async () => (await persistent()).sqliteWasmOpfs,
};
