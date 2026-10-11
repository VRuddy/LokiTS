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
  onversionchange?: (event: IDBVersionChangeEvent) => void;
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
  chunkSize!: number;
  megachunkCount!: number;
  lazyCollections!: string[];
  #idb: IDBDatabase | null;
  #idbName: string | null;
  // what this adapter last saved or loaded, and for which database
  #prevFor: string | null;
  #prevLokiVersionId: string | null;
  // names known to be stored: a save that lost one of them rewrites everything (removed or renamed)
  #prevNames: Set<string> | null;
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
    this.#prevNames = null;
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
      this.#prevNames = null;
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
    this.#idb = db;
    this.#idbName = dbname;
    return db;
  }

  async #load(dbname: string): Promise<object | null> {
    const db = await this.#open(dbname);
    const deserialize = this.options.deserializeChunk;
    const chunks = await readAllChunks(
      db,
      this.megachunkCount,
      (chunk: StoredChunk) => parseChunk(chunk, deserialize, this.lazyCollections),
      this.options.onFetchStart,
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
      this.#prevNames = new Set(loki.collections.map((c: { name: string }) => c.name));
      return loki;
    } catch (err) {
      this.#prevLokiVersionId = null;
      this.#prevNames = null;
      throw err;
    }
  }

  async #save(dbname: string, getLokiCopy: () => any): Promise<void> {
    const db = await this.#open(dbname);
    await new Promise<void>((resolve, reject) => {
      let tx: IDBTransaction;
      try {
        tx = db.transaction([STORE], 'readwrite');
      } catch (err) {
        reject(translateDomError(err, `saving IndexedDB ${dbname}`));
        return;
      }
      const store = tx.objectStore(STORE);
      let failure: unknown;
      let saved = null as { versionId: string; names: Set<string> } | null;
      let overwrote = false;

      tx.oncomplete = () => {
        if (saved) {
          this.#prevLokiVersionId = saved.versionId;
          this.#prevNames = saved.names;
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
            `saving IndexedDB ${dbname}`,
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
        const versionId = writeChunks(sink, loki, full, this.options);
        saved = { versionId, names: new Set(namesOf(loki)) };
        (tx as IDBTransaction & { commit?: () => void }).commit?.();
      };

      // read and write in one transaction: if the stored version is still the one we wrote or read, the
      // stored chunks match it and only the changes are needed; otherwise rewrite everything
      onRequest(
        store.get('loki'),
        (record) => {
          const loki = getLokiCopy();
          const names = namesOf(loki);
          const stored = versionIdOf(record as StoredChunk | undefined);
          const ours = stored !== null && stored === this.#prevLokiVersionId;
          const lostName =
            this.#prevNames !== null && [...this.#prevNames].some((name) => !names.includes(name));
          if (ours && !lostName) {
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
      this.#prevNames = null;
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
}

const namesOf = (loki: { collections: CollectionLike[] }): string[] =>
  loki.collections.map((collection) => collection.name);
