import { LokiFsAdapter } from './adapters/FsAdapter';
import { LokiLocalStorageAdapter } from './adapters/LocalStorageAdapter';
import { LokiMemoryAdapter } from './adapters/MemoryAdapter';
import { LokiPartitioningAdapter } from './adapters/PartitioningAdapter';
import { Collection } from './core/Collection';
import { Loki } from './core/Loki';
import { DynamicView } from './indexing/DynamicView';
import { KeyValueStore } from './indexing/KeyValueStore';
import { aeqHelper, Comparators, gtHelper, ltHelper } from './query/comparators';
import { LokiOps } from './query/operators';
import { Resultset } from './query/Resultset';
import { deepFreeze, freeze, unFreeze } from './utils/freeze';

// Static members of the public object (formerly assigned on `Loki` at the end of lokijs.js).
// They are assigned here, and only here, to avoid circular imports between modules.
Object.assign(Loki, {
  deepFreeze,
  freeze,
  unFreeze,
  LokiOps,
  Collection,
  DynamicView,
  Resultset,
  KeyValueStore,
  LokiMemoryAdapter,
  LokiPartitioningAdapter,
  LokiLocalStorageAdapter,
  LokiFsAdapter,
  persistenceAdapters: {
    fs: LokiFsAdapter,
    localStorage: LokiLocalStorageAdapter,
  },
  aeq: aeqHelper,
  lt: ltHelper,
  gt: gtHelper,
  Comparators,
});

export const loki = Loki;
export default Loki;

export * from './adapters/FsAdapter';
export * from './adapters/LocalStorageAdapter';
export * from './adapters/MemoryAdapter';
export * from './adapters/PartitioningAdapter';
export * from './core/Collection';
export * from './core/Loki';
export * from './events/EventEmitter';
export * from './indexing/BinaryIndex';
export * from './indexing/DynamicView';
export * from './indexing/ExactIndex';
export * from './indexing/KeyValueStore';
export * from './indexing/SortedIndex';
export * from './indexing/UniqueIndex';
export * from './query/comparators';
export * from './query/operators';
export * from './query/Resultset';
export * from './types/adapter';
export * from './types/document';
export * from './types/query';
export * from './utils/clone';
export * from './utils/freeze';
export * from './utils/helpers';
export { Loki };
