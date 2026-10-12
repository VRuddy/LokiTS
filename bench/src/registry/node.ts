import type { MemoryEngine, PersistentEngine } from '../core/engine.ts';

export const NODE_MEMORY_ENGINES: Record<string, () => Promise<MemoryEngine>> = {
  lokits: async () => (await import('../engines/shared/lokits.ts')).lokits,
  lokijs: async () => (await import('../engines/shared/lokijs.ts')).lokijs,
};

export const NODE_PERSISTENT_ENGINES: Record<string, () => Promise<PersistentEngine>> = {};
