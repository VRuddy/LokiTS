import { LokiEncryptedAdapter } from './adapters/EncryptedAdapter';
import { LokiFsAdapter } from './adapters/FsAdapter';
import { LokiFsStructuredAdapter } from './adapters/FsStructuredAdapter';
import { LokiLocalStorageAdapter } from './adapters/LocalStorageAdapter';
import { LokiMemoryAdapter } from './adapters/MemoryAdapter';
import { LokiPartitioningAdapter } from './adapters/PartitioningAdapter';
import { Collection } from './core/Collection';
import { Loki } from './core/Loki';
import { LokiEventEmitter } from './events/EventEmitter';
import { DynamicView } from './indexing/DynamicView';
import { KeyValueStore } from './indexing/KeyValueStore';
import { aeqHelper, Comparators, gtHelper, ltHelper } from './query/comparators';
import { LokiOps } from './query/operators';
import { Resultset } from './query/Resultset';
import { deepFreeze, freeze, unFreeze } from './utils/freeze';

// Statics of the public object (formerly assigned on `Loki` at the end of lokijs.js).
// They are attached here, and only here, to avoid circular imports between modules.
const statics = {
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
  LokiFsStructuredAdapter,
  LokiEncryptedAdapter,
  persistenceAdapters: {
    fs: LokiFsAdapter,
    localStorage: LokiLocalStorageAdapter,
  },
  aeq: aeqHelper,
  lt: ltHelper,
  gt: gtHelper,
  Comparators,
};

/** `Loki` with its static members attached, as exposed by the original `lokijs` module. */
export const loki = Object.assign(Loki, statics);
export default loki;

export type { LokiEncryptedAdapterOptions } from './adapters/EncryptedAdapter';
export type {
  CheckIndexOptions,
  CollectionChange,
  CollectionEvents,
  CollectionOptions,
} from './core/Collection';
export type { LokiConfigOptions, LokiEvents } from './core/Loki';
export type {
  DynamicViewEvents,
  DynamicViewFilter,
  DynamicViewOptions,
  DynamicViewSortCriteria,
  DynamicViewSortCriteriaSimple,
} from './indexing/DynamicView';
export type { DrainOptions } from './persistence/save-queue';
export type { ResultsetDataOptions, SimpleSortOptions, TransformStep } from './query/Resultset';
export type {
  AnyLokiAdapter,
  LegacyLokiAdapter,
  LokiAdapter,
  LokiIncrementalAdapter,
  LokiKeyListingAdapter,
  LokiLineStreamAdapter,
  LokiPersistenceAdapter,
} from './types/adapter';
export type { LokiDocument, LokiMeta } from './types/document';
export type { LokiQuery, QueryOperators } from './types/query';
export type { CloneMethod } from './utils/clone';
export {
  Collection,
  Comparators,
  DynamicView,
  deepFreeze,
  freeze,
  KeyValueStore,
  Loki,
  LokiEncryptedAdapter,
  LokiEventEmitter,
  LokiFsAdapter,
  LokiFsStructuredAdapter,
  LokiLocalStorageAdapter,
  LokiMemoryAdapter,
  LokiOps,
  LokiPartitioningAdapter,
  Resultset,
  unFreeze,
};
