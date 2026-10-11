// Ported from LokiJS (incremental-indexeddb-adapter.js), MIT. Original author: radex (Radek Pietruszewski).
import { invoke, withAdapterCallback } from '../persistence/callbacks';
import { translateDomError } from './errors';
import {
  assembleLoki,
  CHUNK_SIZE,
  type CollectionLike,
  parseChunk,
  STORE,
  type StoredChunk,
  versionIdOf,
  writeChunks,
} from './indexeddb/chunks';
import { indexedDBFactory, onRequest, openDatabase, readAllChunks } from './indexeddb/idb';

export interface LokiIndexedDBAdapterOptions {
  /** Another connection changed the database (most likely deleted it from another tab). */
  // structural so that the declarations do not need the DOM lib; method syntax keeps accepting
  // handlers typed with IDBVersionChangeEvent
  onversionchange?(event: {
    readonly oldVersion: number;
    readonly newVersion: number | null;
  }): void;
  /** Called once the read has started: code can run while IndexedDB fetches. */
  onFetchStart?: () => void;
  /** Called after a save had to overwrite changes written by another tab. */
  onDidOverwrite?: () => void;
  /** Transforms a chunk of documents before it is stored; requires `deserializeChunk`. */
  serializeChunk?: (collectionName: string, chunk: object[]) => unknown;
  deserializeChunk?: (collectionName: string, chunk: any) => object[];
  /** Parallel reads when loading more than 100 chunks (default 24, even, at least 4). */
  megachunkCount?: number;
  /** Collections whose documents are only parsed when first used. */
  lazyCollections?: string[];
}

/**
 * IndexedDB adapter that only rewrites the chunks of 100 documents that changed. Same storage format as
 * the incremental IndexedDB adapter of LokiJS: databases written by one are read by the other.
 */
export class LokiIndexedDBAdapter {
  mode!: 'incremental';
  options!: LokiIndexedDBAdapterOptions;
  /** Documents per stored chunk: fixed by the storage format. */
  readonly chunkSize!: number;
  megachunkCount!: number;
  lazyCollections!: string[];
  #idb: IDBDatabase | null;
  #idbName: string | null;
  // what this adapter last saved or loaded, and for which database
  #prevFor: string | null;
  #prevLokiVersionId: string | null;
  // maxId of each stored collection: a save where one is missing, new or lower (removed, renamed,
  // recreated, cleared) rewrites everything, since stale chunks beyond the new maxId would come back
  #prevMaxIds: Map<string, number> | null;
  #queue: Promise<unknown>;

  constructor(options: LokiIndexedDBAdapterOptions = {}) {
    this.mode = 'incremental';
    this.options = options;
    this.chunkSize = CHUNK_SIZE;
    this.megachunkCount = options.megachunkCount ?? 24;
    this.lazyCollections = options.lazyCollections ?? [];
    this.#idb = null;
    this.#idbName = null;
    this.#prevFor = null;
    this.#prevLokiVersionId = null;
    this.#prevMaxIds = null;
    this.#queue = Promise.resolve();

    if (!(this.megachunkCount >= 4 && this.megachunkCount % 2 === 0)) {
      throw new Error('megachunkCount must be >=4 and divisible by 2');
    }
    if (Boolean(options.serializeChunk) !== Boolean(options.deserializeChunk)) {
      throw new Error('serializeChunk and deserializeChunk must be passed together');
    }
  }

  /** Resolves to false where IndexedDB is missing or refuses to open (some private modes). */
  static async isSupported(): Promise<boolean> {
    try {
      const factory = indexedDBFactory();
      const db = await openDatabase(factory, 'loki-ts-support-probe');
      db.close();
      factory.deleteDatabase('loki-ts-support-probe');
      return true;
    } catch {
      return false;
    }
  }

  loadDatabase(dbname: string, callback?: (result: any) => void): Promise<object | null> {
    return withAdapterCallback(
      this.#serialized(() => this.#load(dbname)),
      callback,
      'load',
    ) as Promise<object | null>;
  }

  saveDatabase(
    dbname: string,
    getLokiCopy: () => any,
    callback?: (err?: any) => void,
  ): Promise<void> {
    return withAdapterCallback(
      this.#serialized(() => this.#save(dbname, getLokiCopy)),
      callback,
      'write',
    ) as Promise<void>;
  }

  deleteDatabase(dbname: string, callback?: (err?: any) => void): Promise<void> {
    return withAdapterCallback(
      this.#serialized(() => this.#delete(dbname)),
      callback,
      'write',
    ) as Promise<void>;
  }

  #serialized<T>(operation: () => Promise<T>): Promise<T> {
    const run = this.#queue.then(operation, operation);
    this.#queue = run.catch(() => undefined);
    return run;
  }

  #close(): void {
    this.#idb?.close();
    this.#idb = null;
    this.#idbName = null;
  }

  async #open(dbname: string): Promise<IDBDatabase> {
    if (this.#idb && this.#idbName === dbname) {
      return this.#idb;
    }
    this.#close();
    // reopening after a versionchange keeps the state: the stored version then differs and forces a full save
    if (this.#prevFor !== dbname) {
      this.#prevFor = dbname;
      this.#prevLokiVersionId = null;
      this.#prevMaxIds = null;
    }
    const db = await openDatabase(indexedDBFactory(), dbname);
    db.onversionchange = (event) => {
      if (this.#idb !== db) {
        return;
      }
      // closing lets the other connection's delete or upgrade go through
      this.#close();
      if (this.options.onversionchange) {
        invoke(this.options.onversionchange, event);
      }
    };
    // closed by the browser (storage cleared, IndexedDB server lost): reopen on the next operation
    db.onclose = () => {
      if (this.#idb === db) {
        this.#close();
      }
    };
    this.#idb = db;
    this.#idbName = dbname;
    return db;
  }

  // `run` gets the transaction synchronously (no await in between), while it is still active
  async #withTransaction<T>(
    dbname: string,
    mode: IDBTransactionMode,
    context: string,
    run: (tx: IDBTransaction) => Promise<T>,
  ): Promise<T> {
    let db = await this.#open(dbname);
    let tx: IDBTransaction;
    try {
      tx = db.transaction([STORE], mode);
    } catch (err) {
      // the connection can be closed before onclose fires: reopen once
      if ((err as { name?: unknown } | null)?.name !== 'InvalidStateError') {
        throw translateDomError(err, context);
      }
      if (this.#idb === db) {
        this.#close();
      }
      db = await this.#open(dbname);
      try {
        tx = db.transaction([STORE], mode);
      } catch (retryErr) {
        throw translateDomError(retryErr, context);
      }
    }
    return run(tx);
  }

  async #load(dbname: string): Promise<object | null> {
    const deserialize = this.options.deserializeChunk;
    const chunks = await this.#withTransaction(dbname, 'readonly', 'reading IndexedDB', (tx) =>
      readAllChunks(
        tx,
        this.megachunkCount,
        (chunk: StoredChunk) => parseChunk(chunk, deserialize, this.lazyCollections),
        this.options.onFetchStart,
      ),
    );
    if (chunks.length === 0) {
      return null;
    }
    try {
      const loki = assembleLoki(chunks, {
        deserializeChunk: deserialize,
        lazyCollections: this.lazyCollections,
      });
      this.#prevLokiVersionId = loki.idbVersionId || null;
      this.#prevMaxIds = maxIdsOf(loki.collections);
      return loki;
    } catch (err) {
      this.#prevLokiVersionId = null;
      this.#prevMaxIds = null;
      throw err;
    }
  }

  async #save(dbname: string, getLokiCopy: () => any): Promise<void> {
    const context = `saving IndexedDB ${dbname}`;
    await this.#withTransaction(dbname, 'readwrite', context, (tx) =>
      this.#write(tx, getLokiCopy, context),
    );
  }

  #write(tx: IDBTransaction, getLokiCopy: SaveArgs[1], context: string): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const store = tx.objectStore(STORE);
      let failure: unknown;
      let saved = null as { versionId: string; maxIds: Map<string, number> | null } | null;
      let overwrote = false;

      tx.oncomplete = () => {
        if (saved) {
          this.#prevLokiVersionId = saved.versionId;
          this.#prevMaxIds = saved.maxIds;
        }
        resolve();
        if (overwrote && this.options.onDidOverwrite) {
          invoke(this.options.onDidOverwrite);
        }
      };
      tx.onabort = () => {
        reject(
          translateDomError(
            failure ?? tx.error ?? new Error('IndexedDB transaction aborted'),
            context,
          ),
        );
      };
      const fail = (err: unknown) => {
        failure = err;
        try {
          tx.abort();
        } catch {
          // already finished: onabort or onerror reports it
        }
      };
      const write = (loki: any, full: { keys: string[] } | null) => {
        const sink = {
          put: (chunk: StoredChunk) => {
            store.put(chunk);
          },
          delete: (key: string) => {
            store.delete(key);
          },
        };
        const maxIds = maxIdsOf(loki.collections);
        const versionId = writeChunks(sink, loki, full, this.options);
        saved = { versionId, maxIds };
        (tx as IDBTransaction & { commit?: () => void }).commit?.();
      };

      // read and write in one transaction: if the stored version is still the one we wrote or read, the
      // stored chunks match it and only the changes are needed; otherwise rewrite everything
      onRequest(
        store.get('loki'),
        (record) => {
          const loki = getLokiCopy();
          const stored = versionIdOf(record as StoredChunk | undefined);
          const ours = stored !== null && stored === this.#prevLokiVersionId;
          if (ours && this.#onlyGrew(loki.collections)) {
            write(loki, null);
            return;
          }
          overwrote = stored !== null && stored !== this.#prevLokiVersionId;
          onRequest(store.getAllKeys(), (keys) => write(loki, { keys: keys as string[] }), fail);
        },
        fail,
      );
    });
  }

  async #delete(dbname: string): Promise<void> {
    if (this.#idbName === dbname) {
      this.#close();
    }
    if (this.#prevFor === dbname) {
      this.#prevLokiVersionId = null;
      this.#prevMaxIds = null;
    }
    const factory = indexedDBFactory();
    await new Promise<void>((resolve, reject) => {
      const request = factory.deleteDatabase(dbname);
      request.onsuccess = () => resolve();
      request.onerror = () =>
        reject(translateDomError(request.error, `deleting IndexedDB ${dbname}`));
      // onblocked: the deletion completes once the other connections close on versionchange
    });
  }

  #onlyGrew(collections: CollectionLike[]): boolean {
    const prev = this.#prevMaxIds;
    if (prev === null || prev.size !== collections.length) {
      return false;
    }
    return collections.every((collection) => {
      const maxId = prev.get(collection.name);
      return maxId !== undefined && collection.maxId >= maxId;
    });
  }
}

type SaveArgs = Parameters<LokiIndexedDBAdapter['saveDatabase']>;

// null when a maxId is unknown (a collection stored without metadata): the next save is then a full one
function maxIdsOf(collections: { name: string; maxId?: unknown }[]): Map<string, number> | null {
  const maxIds = new Map<string, number>();
  for (const collection of collections) {
    if (typeof collection.maxId !== 'number') {
      return null;
    }
    maxIds.set(collection.name, collection.maxId);
  }
  return maxIds;
}
