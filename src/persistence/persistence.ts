import type { Collection } from '../core/Collection';
import type { Loki } from '../core/Loki';
import type { AnyLokiAdapter } from '../types/adapter';
import { callAdapter } from './adapter-bridge';

/** The part of Loki that persistence needs. */
export interface PersistenceHost {
  filename: string;
  persistenceAdapter: AnyLokiAdapter | null;
  collections: Collection[];
  ignoreAutosave: boolean;
  serialize(): string;
  copy(options?: { removeNonSerializable?: boolean }): Loki;
  loadJSON(serializedDb: string, options?: any): void;
  loadJSONObject(dbObject: any, options?: any): void;
  autosaveClearFlags(): void;
  emit(event: 'loaded', message: string): void;
}

const notConfigured = () => new Error('persistenceAdapter not configured');

export async function loadFromAdapter(host: PersistenceHost, options?: any): Promise<void> {
  const adapter = host.persistenceAdapter;
  if (adapter === null) {
    throw notConfigured();
  }

  const result = await callAdapter(adapter, 'loadDatabase', [host.filename], 'load');

  if (typeof result === 'string') {
    host.loadJSON(result, options || {});
    host.emit('loaded', `database ${host.filename} loaded`);
    return;
  }
  if (!result) {
    host.emit('loaded', `empty database ${host.filename} loaded`);
    return;
  }
  if (typeof result === 'object') {
    host.loadJSONObject(result, options || {});
    host.emit('loaded', `database ${host.filename} loaded`);
    return;
  }
  throw new Error(`unexpected adapter response : ${result}`);
}

export async function saveToAdapter(host: PersistenceHost): Promise<void> {
  const adapter = host.persistenceAdapter as Record<string, any> | null;
  if (!adapter) {
    throw notConfigured();
  }

  if (adapter.mode === 'incremental') {
    return saveIncremental(host, adapter);
  }

  if (adapter.mode === 'reference' && typeof adapter.exportDatabase === 'function') {
    const copy = host.copy({ removeNonSerializable: true });
    await callAdapter(adapter, 'exportDatabase', [host.filename, copy], 'write');
    // cleared only after the export: reference adapters (partitioning) read `dirty` to pick what to write
    host.autosaveClearFlags();
    return;
  }

  // the adapter may be asynchronous: clear `dirty` now so that updates made during the save trigger
  // the next autosave, and restore it if the save fails so autosave tries again
  const dirtyBefore = host.collections.filter((col) => col.dirty);
  host.autosaveClearFlags();
  try {
    await callAdapter(adapter, 'saveDatabase', [host.filename, host.serialize()], 'write');
  } catch (err) {
    for (const col of dirtyBefore) {
      col.dirty = true;
    }
    throw err;
  }
}

async function saveIncremental(host: PersistenceHost, adapter: object): Promise<void> {
  let cachedDirty: [boolean, number[]][] | undefined;
  let copyError: Error | undefined;

  // ignore autosave until the copy is taken: only then can the dirty flags be cleared
  host.ignoreAutosave = true;
  const getLokiCopy = () => {
    host.ignoreAutosave = false;
    if (cachedDirty) {
      copyError = new Error('adapter error - getLokiCopy called more than once');
      return undefined;
    }
    const lokiCopy = host.copy({ removeNonSerializable: true });
    // cleared before the save, so updates made meanwhile are saved next time
    cachedDirty = host.collections.map((col) => [col.dirty, col.dirtyIds]);
    for (const col of host.collections) {
      col.dirty = false;
      col.dirtyIds = [];
    }
    return lokiCopy;
  };

  try {
    await callAdapter(adapter, 'saveDatabase', [host.filename, getLokiCopy], 'write');
  } catch (err) {
    if (cachedDirty) {
      const cached = cachedDirty;
      host.collections.forEach((col, i) => {
        col.dirty = col.dirty || cached[i][0];
        col.dirtyIds = col.dirtyIds.concat(cached[i][1]);
      });
    }
    throw err;
  } finally {
    host.ignoreAutosave = false;
  }

  if (copyError) {
    throw copyError;
  }
}

export async function deleteFromAdapter(host: PersistenceHost): Promise<void> {
  const adapter = host.persistenceAdapter;
  if (adapter === null) {
    throw notConfigured();
  }
  await callAdapter(adapter, 'deleteDatabase', [host.filename], 'write');
}
