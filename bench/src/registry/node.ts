import type { MemoryEngine, PersistentEngine } from '../core/engine.ts';

export const NODE_MEMORY_ENGINES: Record<string, () => Promise<MemoryEngine>> = {
  lokits: async () => (await import('../engines/shared/lokits.ts')).lokits,
  lokijs: async () => (await import('../engines/shared/lokijs.ts')).lokijs,
  lokidb: async () => (await import('../engines/shared/lokidb.ts')).lokidb,
  tinybase: async () => (await import('../engines/shared/tinybase.ts')).tinybase,
  'rxdb-memory': async () => (await import('../engines/shared/rxdb.ts')).rxdbMemory,
  sqlite: async () => (await import('../engines/node/sqlite.ts')).sqliteNode,
};

export const NODE_PERSISTENT_ENGINES: Record<string, () => Promise<PersistentEngine>> = {};
