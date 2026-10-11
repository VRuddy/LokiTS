// Ported from LokiJS (lokijs.js), MIT. Original author: Joe Minichino and LokiJS contributors.
import { LokiFsAdapter } from '../adapters/FsAdapter';
import { LokiLocalStorageAdapter } from '../adapters/LocalStorageAdapter';
import { LokiMemoryAdapter } from '../adapters/MemoryAdapter';
import { LokiEventEmitter } from '../events/EventEmitter';
import { invoke, settle } from '../persistence/callbacks';
import {
  deleteFromAdapter,
  loadFromAdapter,
  type PersistenceHost,
  saveToAdapter,
} from '../persistence/persistence';
import { type DrainOptions, SaveQueue } from '../persistence/save-queue';
import type { AnyLokiAdapter } from '../types/adapter';
import { deepFreeze } from '../utils/freeze';
import { Utils } from '../utils/helpers';
import { Collection, type CollectionOptions } from './Collection';

/** Options accepted by the Loki constructor and {@link Loki#configureOptions}. */
export interface LokiConfigOptions {
  env?: string;
  verbose?: boolean;
  persistenceMethod?: 'fs' | 'localStorage' | 'memory';
  adapter?: AnyLokiAdapter | null;
  autoload?: boolean;
  autoloadCallback?: (err?: any) => void;
  autosave?: boolean;
  autosaveInterval?: number | string;
  autosaveCallback?: (err?: any) => void;
  serializationMethod?: 'normal' | 'pretty' | 'destructured' | string;
  destructureDelimiter?: string;
  throttledSaves?: boolean;
  [key: string]: any;
}

/**
 * Loki: The main database class
 *
 * @param filename - name of the file to be saved to
 * @param options - (Optional) config options object
 * @param options.env - override environment detection as 'NODEJS', 'BROWSER', 'CORDOVA'
 * @param options.verbose - enable console output (default is 'false')
 * @param options.autosave - (default: false)
 * @param options.autosaveInterval - (default: 5000) how often to save the database to disk
 * @param options.autoload - (default: false) enables autoload on loki instantiation
 * @param options.autoloadCallback - user callback called after database load
 * @param options.adapter - an instance of a loki persistence adapter
 * @param options.serializationMethod - ['normal', 'pretty', 'destructured']
 * @param options.destructureDelimiter - string delimiter used for destructured serialization
 * @param options.throttledSaves - (default: true) debounces multiple calls to to saveDatabase reducing number of disk I/O operations
 *                                  and guaranteeing proper serialization of the calls.
 */
export interface LokiEvents {
  init: [];
  loaded: [message: string];
  flushChanges: [];
  close: [];
  changes: [];
  warning: [warning: unknown];
  [event: string]: unknown[];
}

export class Loki extends LokiEventEmitter<LokiEvents> {
  filename!: string;
  collections!: Collection[];
  databaseVersion!: number;
  engineVersion!: number;
  autosave!: boolean;
  autosaveInterval!: number;
  autosaveHandle!: any;
  throttledSaves!: boolean;
  options!: LokiConfigOptions;
  persistenceMethod!: string | null | undefined;
  persistenceAdapter!: AnyLokiAdapter | null;
  /** @internal */
  declare saveQueue: SaveQueue;
  verbose!: boolean;
  ENV!: string;
  /** set by loadJSONObject */
  name!: string;
  /** set when an adapter is configured (incremental mode) */
  isIncremental!: boolean;
  /** set transiently during incremental saves */
  ignoreAutosave!: boolean;

  constructor(filename?: string, options?: LokiConfigOptions) {
    super();
    this.filename = filename || 'loki.db';
    this.collections = [];

    // persist version of code which created the database to the database.
    // could use for upgrade scenarios
    this.databaseVersion = 1.5;
    this.engineVersion = 1.5;

    // autosave support (disabled by default)
    // pass autosave: true, autosaveInterval: 6000 in options to set 6 second autosave
    this.autosave = false;
    this.autosaveInterval = 5000;
    this.autosaveHandle = null;
    this.throttledSaves = true;

    this.options = {};

    // currently keeping persistenceMethod and persistenceAdapter as loki level properties that
    // will not or cannot be deserialized.  You are required to configure persistence every time
    // you instantiate a loki object (or use default environment detection) in order to load the database anyways.

    // persistenceMethod could be 'fs', 'localStorage', or 'adapter'
    // this is optional option param, otherwise environment detection will be used
    // if user passes their own adapter we will force this method to 'adapter' later, so no need to pass method option.
    this.persistenceMethod = null;

    // retain reference to optional (non-serializable) persistenceAdapter 'instance'
    this.persistenceAdapter = null;

    // non-enumerable: the queue must stay out of the serialized database
    Object.defineProperty(this, 'saveQueue', {
      value: new SaveQueue(
        () => saveToAdapter(this as PersistenceHost),
        () => this.throttledSaves,
      ),
      writable: true,
      configurable: true,
    });

    // enable console output if verbose flag is set (disabled by default)
    this.verbose =
      options && Object.hasOwn(options, 'verbose') ? (options.verbose as boolean) : false;

    this.events = {
      init: [],
      loaded: [],
      flushChanges: [],
      close: [],
      changes: [],
      warning: [],
    };

    const getENV = (): string => {
      const g: any = typeof global !== 'undefined' ? global : undefined;
      if (typeof global !== 'undefined' && (g.android || g.NSObject)) {
        // If no adapter assume nativescript which needs adapter to be passed manually
        return 'NATIVESCRIPT'; //nativescript
      }

      if (typeof window === 'undefined') {
        return 'NODEJS';
      }

      if (typeof global !== 'undefined' && g.window && typeof process !== 'undefined') {
        return 'NODEJS'; //node-webkit
      }

      if (typeof document !== 'undefined') {
        if (document.URL.indexOf('http://') === -1 && document.URL.indexOf('https://') === -1) {
          return 'CORDOVA';
        }
        return 'BROWSER';
      }
      return 'CORDOVA';
    };

    // refactored environment detection due to invalid detection for browser environments.
    // if they do not specify an options.env we want to detect env rather than default to nodejs.
    // currently keeping two properties for similar thing (options.env and options.persistenceMethod)
    //   might want to review whether we can consolidate.
    if (options && Object.hasOwn(options, 'env')) {
      this.ENV = options.env as string;
    } else {
      this.ENV = getENV();
    }

    // not sure if this is necessary now that i have refactored the line above
    if (this.ENV === 'undefined') {
      this.ENV = 'NODEJS';
    }

    this.configureOptions(options, true);

    this.on('init', this.clearChanges);
  }

  /**
   * Creates a database and loads it from its adapter. A database that does not exist yet opens empty;
   * a real adapter error or corrupted data rejects. Replaces the `autoload` options; `autosave` starts once the load succeeded.
   *
   * @example
   * const db = await Loki.open('app.db', { adapter: new LokiFsAdapter() });
   */
  static async open(filename: string, options: LokiConfigOptions = {}): Promise<Loki> {
    const { autoload: _autoload, autoloadCallback: _autoloadCallback, autosave, ...rest } = options;
    const db = new Loki(filename, rest);
    if (db.persistenceAdapter) {
      await db.loadDatabase(rest);
    }
    // enabled after the load so a rejected open leaves no timer behind
    if (autosave) {
      db.autosaveEnable(rest, rest.autosaveCallback);
    }
    return db;
  }

  /** True while a save runs or a load holds saves back. */
  get throttledSavePending(): boolean {
    return this.saveQueue.busy;
  }

  /**
   * Allows reconfiguring database options
   *
   * @param options - configuration options to apply to loki db object
   * @param options.env - override environment detection as 'NODEJS', 'BROWSER', 'CORDOVA'
   * @param options.verbose - enable console output (default is 'false')
   * @param options.autosave - enables autosave
   * @param options.autosaveInterval - time interval (in milliseconds) between saves (if dirty)
   * @param options.autoload - enables autoload on loki instantiation
   * @param options.autoloadCallback - user callback called after database load
   * @param options.adapter - an instance of a loki persistence adapter
   * @param options.serializationMethod - ['normal', 'pretty', 'destructured']
   * @param options.destructureDelimiter - string delimiter used for destructured serialization
   * @param initialConfig - (internal) true is passed when loki ctor is invoking
   */
  configureOptions(options?: LokiConfigOptions, initialConfig?: boolean): void {
    const defaultPersistence: Record<string, string> = {
      NODEJS: 'fs',
      BROWSER: 'localStorage',
      CORDOVA: 'localStorage',
      MEMORY: 'memory',
    };
    const persistenceMethods: Record<string, new () => AnyLokiAdapter> = {
      fs: LokiFsAdapter as unknown as new () => AnyLokiAdapter,
      localStorage: LokiLocalStorageAdapter as unknown as new () => AnyLokiAdapter,
      memory: LokiMemoryAdapter as unknown as new () => AnyLokiAdapter,
    };

    this.options = {};

    this.persistenceMethod = null;
    // retain reference to optional persistence adapter 'instance'
    // currently keeping outside options because it can't be serialized
    this.persistenceAdapter = null;

    // process the options
    if (typeof options !== 'undefined') {
      this.options = options;

      if (Object.hasOwn(this.options, 'persistenceMethod')) {
        // check if the specified persistence method is known
        if (typeof persistenceMethods[options.persistenceMethod as string] === 'function') {
          this.persistenceMethod = options.persistenceMethod;
          this.persistenceAdapter = new persistenceMethods[options.persistenceMethod as string]();
        }
        // should be throw an error here, or just fall back to defaults ??
      }

      // if user passes adapter, set persistence mode to adapter and retain persistence adapter instance
      if (Object.hasOwn(this.options, 'adapter')) {
        this.persistenceMethod = 'adapter';
        this.persistenceAdapter = options.adapter as AnyLokiAdapter;
        this.options.adapter = null;

        // if true, will keep track of dirty ids
        this.isIncremental = this.persistenceAdapter.mode === 'incremental';
      }

      // if they want to load database on loki instantiation, now is a good time to load... after adapter set and before possible autosave initiation
      if (options.autoload && initialConfig) {
        // for autoload, let the constructor complete before firing callback
        setTimeout(() => {
          this.loadDatabase(options, options.autoloadCallback);
        }, 1);
      }

      if (Object.hasOwn(this.options, 'autosaveInterval')) {
        this.autosaveDisable();
        this.autosaveInterval = parseInt(this.options.autosaveInterval as string, 10);
      }

      if (Object.hasOwn(this.options, 'autosave') && this.options.autosave) {
        this.autosaveDisable();
        this.autosave = true;

        if (Object.hasOwn(this.options, 'autosaveCallback')) {
          this.autosaveEnable(options, options.autosaveCallback);
        } else {
          this.autosaveEnable();
        }
      }

      if (Object.hasOwn(this.options, 'throttledSaves')) {
        this.throttledSaves = this.options.throttledSaves as boolean;
      }
    } // end of options processing

    // ensure defaults exists for options which were not set
    if (!Object.hasOwn(this.options, 'serializationMethod')) {
      this.options.serializationMethod = 'normal';
    }

    // ensure passed or default option exists
    if (!Object.hasOwn(this.options, 'destructureDelimiter')) {
      this.options.destructureDelimiter = '$<\n';
    }

    // if by now there is no adapter specified by user nor derived from persistenceMethod: use sensible defaults
    if (this.persistenceAdapter === null) {
      this.persistenceMethod = defaultPersistence[this.ENV];
      if (this.persistenceMethod) {
        this.persistenceAdapter = new persistenceMethods[this.persistenceMethod]();
      }
    }
  }

  /**
   * Copies 'this' database into a new Loki instance. Object references are shared to make lightweight.
   *
   * @param options - apply or override collection level settings
   * @param options.removeNonSerializable - nulls properties not safe for serialization.
   */
  copy(options?: { removeNonSerializable?: boolean }): Loki {
    // in case running in an environment without accurate environment detection, pass 'NA'
    const databaseCopy = new Loki(this.filename, { env: 'NA' });
    let clen: number;
    let idx: number;

    options = options || {};

    // currently inverting and letting loadJSONObject do most of the work
    databaseCopy.loadJSONObject(this as any, { retainDirtyFlags: true });

    // since our JSON serializeReplacer is not invoked for reference database adapters, this will let us mimic
    if (Object.hasOwn(options, 'removeNonSerializable') && options.removeNonSerializable === true) {
      databaseCopy.autosaveHandle = null;
      databaseCopy.persistenceAdapter = null;

      clen = databaseCopy.collections.length;
      for (idx = 0; idx < clen; idx++) {
        (databaseCopy.collections[idx] as any).constraints = null;
        (databaseCopy.collections[idx] as any).ttl = null;
      }
    }

    return databaseCopy;
  }

  /**
   * Adds a collection to the database.
   * @param name - name of collection to add
   * @param options - (optional) options to configure collection with.
   * @param options.unique - (default: []) array of property names to define unique constraints for
   * @param options.exact - (default: []) array of property names to define exact constraints for
   * @param options.indices - (default: []) array property names to define binary indexes for
   * @param options.asyncListeners - (default: false) whether listeners are called asynchronously
   * @param options.disableMeta - (default: false) set to true to disable meta property on documents
   * @param options.disableChangesApi - (default: true) set to false to enable Changes Api
   * @param options.disableDeltaChangesApi - (default: true) set to false to enable Delta Changes API (requires Changes API, forces cloning)
   * @param options.autoupdate - (default: false) use Object.observe to update objects automatically
   * @param options.clone - (default: false) specify whether inserts and queries clone to/from user
   * @param options.cloneMethod - (default: 'parse-stringify') 'parse-stringify', 'jquery-extend-deep', 'shallow, 'shallow-assign'
   * @param options.ttl - age of document (in ms.) before document is considered aged/stale.
   * @param options.ttlInterval - time interval for clearing out 'aged' documents; not set by default.
   * @returns a reference to the collection which was just added
   */
  addCollection<T extends object = any>(name: string, options?: CollectionOptions): Collection<T> {
    let i: number;
    const len = this.collections.length;

    if (options && options.disableMeta === true) {
      if (options.disableChangesApi === false) {
        throw new Error(
          'disableMeta option cannot be passed as true when disableChangesApi is passed as false',
        );
      }
      if (options.disableDeltaChangesApi === false) {
        throw new Error(
          'disableMeta option cannot be passed as true when disableDeltaChangesApi is passed as false',
        );
      }
      if (typeof options.ttl === 'number' && options.ttl > 0) {
        throw new Error('disableMeta option cannot be passed as true when ttl is enabled');
      }
    }

    for (i = 0; i < len; i += 1) {
      if (this.collections[i].name === name) {
        return this.collections[i] as Collection<T>;
      }
    }

    const collection = new Collection<T>(name, options);
    collection.isIncremental = this.isIncremental;
    this.collections.push(collection);

    if (this.verbose) collection.lokiConsoleWrapper = console;

    return collection;
  }

  loadCollection(collection: Collection): void {
    if (!collection.name) {
      throw new Error('Collection must have a name property to be loaded');
    }
    this.collections.push(collection);
  }

  /**
   * Retrieves reference to a collection by name.
   * @param collectionName - name of collection to look up
   * @returns Reference to collection in database by that name, or null if not found
   */
  getCollection<T extends object = any>(collectionName: string): Collection<T> | null {
    let i: number;
    const len = this.collections.length;

    for (i = 0; i < len; i += 1) {
      if (this.collections[i].name === collectionName) {
        return this.collections[i] as Collection<T>;
      }
    }

    // no such collection
    this.emit('warning', `collection ${collectionName} not found`);
    return null;
  }

  /**
   * Renames an existing loki collection
   * @param oldName - name of collection to rename
   * @param newName - new name of collection
   * @returns reference to the newly renamed collection
   */
  renameCollection<T extends object = any>(oldName: string, newName: string): Collection<T> | null {
    const c = this.getCollection<T>(oldName);

    if (c) {
      c.name = newName;
      // a rename changes what gets persisted: without this, autosave skips it
      c.dirty = true;
    }

    return c;
  }

  /**
   * Returns a list of collections in the database.
   * @returns array of objects containing 'name', 'type', and 'count' properties.
   */
  listCollections(): { name: string; type: string; count: number }[] {
    let i = this.collections.length;
    const colls: { name: string; type: string; count: number }[] = [];

    while (i--) {
      colls.push({
        name: this.collections[i].name,
        type: (this.collections[i] as any).objType,
        count: this.collections[i].data.length,
      });
    }
    return colls;
  }

  /**
   * Removes a collection from the database.
   * @param collectionName - name of collection to remove
   */
  removeCollection(collectionName: string): void {
    let i: number;
    const len = this.collections.length;

    for (i = 0; i < len; i += 1) {
      if (this.collections[i].name === collectionName) {
        const tmpcol = new Collection(collectionName, {});
        const curcol = this.collections[i] as any;
        for (const prop in curcol) {
          if (Object.hasOwn(curcol, prop) && Object.hasOwn(tmpcol, prop)) {
            curcol[prop] = (tmpcol as any)[prop];
          }
        }
        this.collections.splice(i, 1);
        // partitioned layouts store collections by position: the shifted ones must be rewritten
        for (let j = i; j < this.collections.length; j++) {
          this.collections[j].dirty = true;
        }
        return;
      }
    }
  }

  getName(): string {
    return this.name;
  }

  /**
   * serializeReplacer - used to prevent certain properties from being serialized
   *
   */
  serializeReplacer(key: string, value: any): any {
    switch (key) {
      case 'autosaveHandle':
      case 'persistenceAdapter':
      case 'constraints':
      case 'ttl':
        return null;
      case 'lokiConsoleWrapper':
        return null;
      default:
        return value;
    }
  }

  /**
   * Serialize database to a string which can be loaded via {@link Loki#loadJSON}
   *
   * @returns Stringified representation of the loki database.
   */
  serialize(options?: { serializationMethod?: string }): string {
    options = options || {};

    if (!Object.hasOwn(options, 'serializationMethod')) {
      options.serializationMethod = this.options.serializationMethod;
    }

    switch (options.serializationMethod) {
      case 'normal':
        return JSON.stringify(this, this.serializeReplacer);
      case 'pretty':
        return JSON.stringify(this, this.serializeReplacer, 2);
      case 'destructured':
        return this.serializeDestructured() as string; // use default options
      default:
        return JSON.stringify(this, this.serializeReplacer);
    }
  }

  /**
   * Database level destructured JSON serialization routine to allow alternate serialization methods.
   * Internally, Loki supports destructuring via loki "serializationMethod' option and
   * the optional LokiPartitioningAdapter class. It is also available if you wish to do
   * your own structured persistence or data exchange.
   *
   * @param options - output format options for use externally to loki
   * @param options.partitioned - (default: false) whether db and each collection are separate
   * @param options.partition - can be used to only output an individual collection or db (-1)
   * @param options.delimited - (default: true) whether subitems are delimited or subarrays
   * @param options.delimiter - override default delimiter
   *
   * @returns A custom, restructured aggregation of independent serializations.
   */
  serializeDestructured(options?: {
    partitioned?: boolean;
    partition?: number;
    delimited?: boolean;
    delimiter?: string;
  }): string | string[] | string[][] {
    let idx: number;
    let sidx: number;
    let result: any;
    let resultlen: number;
    const reconstruct: any[] = [];
    let dbcopy: Loki | null;

    options = options || {};

    if (!Object.hasOwn(options, 'partitioned')) {
      options.partitioned = false;
    }

    if (!Object.hasOwn(options, 'delimited')) {
      options.delimited = true;
    }

    if (!Object.hasOwn(options, 'delimiter')) {
      options.delimiter = this.options.destructureDelimiter;
    }

    // 'partitioned' along with 'partition' of 0 or greater is a request for single collection serialization
    if (
      options.partitioned === true &&
      Object.hasOwn(options, 'partition') &&
      (options.partition as number) >= 0
    ) {
      return this.serializeCollection({
        delimited: options.delimited,
        delimiter: options.delimiter,
        collectionIndex: options.partition,
      });
    }

    // not just an individual collection, so we will need to serialize db container via shallow copy
    dbcopy = new Loki(this.filename);
    dbcopy.loadJSONObject(this as any);

    for (idx = 0; idx < dbcopy.collections.length; idx++) {
      dbcopy.collections[idx].data = [];
    }

    // if we -only- wanted the db container portion, return it now
    if (options.partitioned === true && options.partition === -1) {
      // since we are deconstructing, override serializationMethod to normal for here
      return dbcopy.serialize({
        serializationMethod: 'normal',
      });
    }

    // at this point we must be deconstructing the entire database
    // start by pushing db serialization into first array element
    reconstruct.push(
      dbcopy.serialize({
        serializationMethod: 'normal',
      }),
    );

    dbcopy = null;

    // push collection data into subsequent elements
    for (idx = 0; idx < this.collections.length; idx++) {
      result = this.serializeCollection({
        delimited: options.delimited,
        delimiter: options.delimiter,
        collectionIndex: idx,
      });

      // NDA : Non-Delimited Array : one iterable concatenated array with empty string collection partitions
      if (options.partitioned === false && options.delimited === false) {
        if (!Array.isArray(result)) {
          throw new Error(
            'a nondelimited, non partitioned collection serialization did not return an expected array',
          );
        }

        // Array.concat would probably duplicate memory overhead for copying strings.
        // Instead copy each individually, and clear old value after each copy.
        // Hopefully this will allow g.c. to reduce memory pressure, if needed.
        resultlen = result.length;

        for (sidx = 0; sidx < resultlen; sidx++) {
          reconstruct.push(result[sidx]);
          result[sidx] = null;
        }

        reconstruct.push('');
      } else {
        reconstruct.push(result);
      }
    }

    // Reconstruct / present results according to four combinations : D, DA, NDA, NDAA
    if (options.partitioned) {
      // DA : Delimited Array of strings [0] db [1] collection [n] collection { partitioned: true, delimited: true }
      // useful for simple future adaptations of existing persistence adapters to save collections separately
      if (options.delimited) {
        return reconstruct;
      }
      // NDAA : Non-Delimited Array with subArrays. db at [0] and collection subarrays at [n] { partitioned: true, delimited : false }
      // This format might be the most versatile for 'rolling your own' partitioned sync or save.
      // Memory overhead can be reduced by specifying a specific partition, but at this code path they did not, so its all.
      return reconstruct;
    }

    // D : one big Delimited string { partitioned: false, delimited : true }
    // This is the method Loki will use internally if 'destructured'.
    // Little memory overhead improvements but does not require multiple asynchronous adapter call scheduling
    if (options.delimited) {
      // indicate no more collections
      reconstruct.push('');

      return reconstruct.join(options.delimiter);
    }
    // NDA : Non-Delimited Array : one iterable array with empty string collection partitions { partitioned: false, delimited: false }
    // This format might be best candidate for custom synchronous syncs or saves

    // indicate no more collections
    reconstruct.push('');

    return reconstruct;
  }

  /**
   * Collection level utility method to serialize a collection in a 'destructured' format
   *
   * @param options - used to determine output of method
   * @param options.delimited - whether to return single delimited string or an array
   * @param options.delimiter - (optional) if delimited, this is delimiter to use
   * @param options.collectionIndex -  specify which collection to serialize data for
   *
   * @returns A custom, restructured aggregation of independent serializations for a single collection.
   */
  serializeCollection(options?: {
    delimited?: boolean;
    delimiter?: string;
    collectionIndex?: number;
  }): string | string[] {
    let docidx: number;
    let resultlines: string[] = [];

    options = options || {};

    if (!Object.hasOwn(options, 'delimited')) {
      options.delimited = true;
    }

    if (!Object.hasOwn(options, 'collectionIndex')) {
      throw new Error("serializeCollection called without 'collectionIndex' option");
    }

    const collectionIndex = options.collectionIndex as number;
    const doccount = this.collections[collectionIndex].data.length;

    resultlines = [];

    for (docidx = 0; docidx < doccount; docidx++) {
      resultlines.push(JSON.stringify(this.collections[collectionIndex].data[docidx]));
    }

    // D and DA
    if (options.delimited) {
      // indicate no more documents in collection (via empty delimited string)
      resultlines.push('');

      return resultlines.join(options.delimiter);
    }
    // NDAA and NDA
    return resultlines;
  }

  /**
   * Database level destructured JSON deserialization routine to minimize memory overhead.
   * Internally, Loki supports destructuring via loki "serializationMethod' option and
   * the optional LokiPartitioningAdapter class. It is also available if you wish to do
   * your own structured persistence or data exchange.
   *
   * @param destructuredSource - destructured json or array to deserialize from
   * @param options - source format options
   * @param options.partitioned - (default: false) whether db and each collection are separate
   * @param options.partition - can be used to deserialize only a single partition
   * @param options.delimited - (default: true) whether subitems are delimited or subarrays
   * @param options.delimiter - override default delimiter
   *
   * @returns An object representation of the deserialized database, not yet applied to 'this' db or document array
   */
  deserializeDestructured(
    destructuredSource: any,
    options?: {
      partitioned?: boolean;
      partition?: number;
      delimited?: boolean;
      delimiter?: string;
    },
  ): any {
    let workarray: any = [];
    let len: number;
    let cdb: any;
    let collIndex = 0;
    let collCount: number;
    let lineIndex = 1;
    let done = false;
    let currObject: any;

    options = options || {};

    if (!Object.hasOwn(options, 'partitioned')) {
      options.partitioned = false;
    }

    if (!Object.hasOwn(options, 'delimited')) {
      options.delimited = true;
    }

    if (!Object.hasOwn(options, 'delimiter')) {
      options.delimiter = this.options.destructureDelimiter;
    }

    // Partitioned
    // DA : Delimited Array of strings [0] db [1] collection [n] collection { partitioned: true, delimited: true }
    // NDAA : Non-Delimited Array with subArrays. db at [0] and collection subarrays at [n] { partitioned: true, delimited : false }
    // -or- single partition
    if (options.partitioned) {
      // handle single partition
      if (Object.hasOwn(options, 'partition')) {
        // db only
        if (options.partition === -1) {
          cdb = JSON.parse(destructuredSource[0]);

          return cdb;
        }

        // single collection, return doc array
        return this.deserializeCollection(
          destructuredSource[(options.partition as number) + 1],
          options,
        );
      }

      // Otherwise we are restoring an entire partitioned db
      cdb = JSON.parse(destructuredSource[0]);
      collCount = cdb.collections.length;
      for (collIndex = 0; collIndex < collCount; collIndex++) {
        // attach each collection docarray to container collection data, add 1 to collection array index since db is at 0
        cdb.collections[collIndex].data = this.deserializeCollection(
          destructuredSource[collIndex + 1],
          options,
        );
      }

      return cdb;
    }

    // Non-Partitioned
    // D : one big Delimited string { partitioned: false, delimited : true }
    // NDA : Non-Delimited Array : one iterable array with empty string collection partitions { partitioned: false, delimited: false }

    // D
    if (options.delimited) {
      workarray = destructuredSource.split(options.delimiter);
      destructuredSource = null; // lower memory pressure
      len = workarray.length;

      if (len === 0) {
        return null;
      }
    }
    // NDA
    else {
      workarray = destructuredSource;
    }

    // first line is database and collection shells
    cdb = JSON.parse(workarray[0]);
    collCount = cdb.collections.length;
    workarray[0] = null;

    while (!done) {
      // empty string indicates either end of collection or end of file
      if (workarray[lineIndex] === '') {
        // if no more collections to load into, we are done
        if (++collIndex > collCount) {
          done = true;
        }
      } else {
        currObject = JSON.parse(workarray[lineIndex]);
        cdb.collections[collIndex].data.push(currObject);
      }

      // lower memory pressure and advance iterator
      workarray[lineIndex++] = null;
    }

    return cdb;
  }

  /**
   * Collection level utility function to deserializes a destructured collection.
   *
   * @param destructuredSource - destructured representation of collection to inflate
   * @param options - used to describe format of destructuredSource input
   * @param options.delimited - (default: false) whether source is delimited string or an array
   * @param options.delimiter - if delimited, this is delimiter to use (if other than default)
   *
   * @returns an array of documents to attach to collection.data.
   */
  deserializeCollection(
    destructuredSource: any,
    options?: {
      partitioned?: boolean;
      delimited?: boolean;
      delimiter?: string;
      collectionIndex?: number;
      partition?: number;
    },
  ): any[] {
    let workarray: any[] = [];
    let idx: number;
    let len: number;

    options = options || {};

    if (!Object.hasOwn(options, 'partitioned')) {
      options.partitioned = false;
    }

    if (!Object.hasOwn(options, 'delimited')) {
      options.delimited = true;
    }

    if (!Object.hasOwn(options, 'delimiter')) {
      options.delimiter = this.options.destructureDelimiter;
    }

    if (options.delimited) {
      workarray = destructuredSource.split(options.delimiter);
      workarray.pop();
    } else {
      workarray = destructuredSource;
    }

    len = workarray.length;
    for (idx = 0; idx < len; idx++) {
      workarray[idx] = JSON.parse(workarray[idx]);
    }

    return workarray;
  }

  /**
   * Inflates a loki database from a serialized JSON string
   *
   * @param serializedDb - a serialized loki database string
   * @param options - apply or override collection level settings
   * @param options.retainDirtyFlags - whether collection dirty flags will be preserved
   */
  loadJSON(serializedDb: string, options?: any): void {
    let dbObject: any;
    if (serializedDb.length === 0) {
      dbObject = {};
    } else {
      // using option defined in instantiated db not what was in serialized db
      switch (this.options.serializationMethod) {
        case 'normal':
        case 'pretty':
          dbObject = JSON.parse(serializedDb);
          break;
        case 'destructured':
          dbObject = this.deserializeDestructured(serializedDb);
          break;
        default:
          dbObject = JSON.parse(serializedDb);
          break;
      }
    }

    this.loadJSONObject(dbObject, options);
  }

  /**
   * Inflates a loki database from a JS object
   *
   * @param dbObject - a serialized loki database string
   * @param options - apply or override collection level settings
   * @param options.retainDirtyFlags - whether collection dirty flags will be preserved
   */
  loadJSONObject(dbObject: any, options?: any): void {
    let i = 0;
    const len = dbObject.collections ? dbObject.collections.length : 0;
    let coll: any;
    let copyColl: any;
    let clen: number;
    let j: number;
    let loader: any;
    let collObj: any;

    this.name = dbObject.name;

    // restore save throttled boolean only if not defined in options
    if (
      Object.hasOwn(dbObject, 'throttledSaves') &&
      options &&
      !Object.hasOwn(options, 'throttledSaves')
    ) {
      this.throttledSaves = dbObject.throttledSaves;
    }

    this.collections = [];

    function makeLoader(coll: any) {
      const collOptions = options[coll.name];
      let inflater: any;

      if (collOptions.proto) {
        inflater = collOptions.inflate || Utils.copyProperties;

        return (data: any) => {
          const collObj = new collOptions.proto();
          inflater(data, collObj);
          return collObj;
        };
      }

      return collOptions.inflate;
    }

    for (i; i < len; i += 1) {
      coll = dbObject.collections[i];

      copyColl = this.addCollection(coll.name, {
        disableChangesApi: coll.disableChangesApi,
        disableDeltaChangesApi: coll.disableDeltaChangesApi,
        disableMeta: coll.disableMeta,
        disableFreeze: Object.hasOwn(coll, 'disableFreeze') ? coll.disableFreeze : true,
      });

      copyColl.adaptiveBinaryIndices = Object.hasOwn(coll, 'adaptiveBinaryIndices')
        ? coll.adaptiveBinaryIndices === true
        : false;
      copyColl.transactional = coll.transactional;
      copyColl.asyncListeners = coll.asyncListeners;
      copyColl.cloneObjects = coll.cloneObjects;
      copyColl.cloneMethod = coll.cloneMethod || 'parse-stringify';
      copyColl.autoupdate = coll.autoupdate;
      copyColl.changes = coll.changes;
      copyColl.dirtyIds = coll.dirtyIds || [];

      if (options && options.retainDirtyFlags === true) {
        copyColl.dirty = coll.dirty;
      } else {
        copyColl.dirty = false;
      }

      if (coll.getData) {
        if (
          (options && Object.hasOwn(options, coll.name)) ||
          !copyColl.disableFreeze ||
          copyColl.autoupdate
        ) {
          throw new Error(`this collection cannot be loaded lazily: ${coll.name}`);
        }
        copyColl.getData = coll.getData;
        const materialize = (target: { getData: (() => unknown) | null }, data: unknown) => {
          target.getData = null;
          Object.defineProperty(target, 'data', {
            value: data,
            writable: true,
            enumerable: true,
            configurable: true,
          });
        };
        Object.defineProperty(copyColl, 'data', {
          get: function (this: { getData: (() => unknown) | null }) {
            const data = this.getData?.();
            materialize(this, data);
            return data;
          },
          set: function (this: { getData: (() => unknown) | null }, data: unknown) {
            materialize(this, data);
          },
        });
      } else {
        // load each element individually
        clen = coll.data.length;
        j = 0;
        if (options && Object.hasOwn(options, coll.name)) {
          loader = makeLoader(coll);

          for (j; j < clen; j++) {
            collObj = loader(coll.data[j]);
            copyColl.data[j] = collObj;
            copyColl.addAutoUpdateObserver(collObj);
            if (!copyColl.disableFreeze) {
              deepFreeze(copyColl.data[j]);
            }
          }
        } else {
          for (j; j < clen; j++) {
            copyColl.data[j] = coll.data[j];
            copyColl.addAutoUpdateObserver(copyColl.data[j]);
            if (!copyColl.disableFreeze) {
              deepFreeze(copyColl.data[j]);
            }
          }
        }
      }

      copyColl.maxId = typeof coll.maxId === 'undefined' ? 0 : coll.maxId;
      if (typeof coll.binaryIndices !== 'undefined') {
        copyColl.binaryIndices = coll.binaryIndices;
      }
      if (typeof coll.transforms !== 'undefined') {
        copyColl.transforms = coll.transforms;
      }

      // regenerate unique indexes
      copyColl.uniqueNames = [];
      if (Object.hasOwn(coll, 'uniqueNames')) {
        copyColl.uniqueNames = coll.uniqueNames;
      }

      // in case they are loading a database created before we added dynamic views, handle undefined
      if (typeof coll.DynamicViews === 'undefined') continue;

      // reinflate DynamicViews and attached Resultsets
      for (let idx = 0; idx < coll.DynamicViews.length; idx++) {
        const colldv = coll.DynamicViews[idx];

        const dv = copyColl.addDynamicView(colldv.name, colldv.options);
        dv.resultdata = colldv.resultdata;
        dv.resultsdirty = colldv.resultsdirty;
        dv.filterPipeline = colldv.filterPipeline;
        dv.sortCriteriaSimple = colldv.sortCriteriaSimple;
        dv.sortCriteria = colldv.sortCriteria;
        dv.sortFunction = null;
        dv.sortDirty = colldv.sortDirty;
        if (!copyColl.disableFreeze) {
          deepFreeze(dv.filterPipeline);
          if (dv.sortCriteriaSimple) {
            deepFreeze(dv.sortCriteriaSimple);
          } else if (dv.sortCriteria) {
            deepFreeze(dv.sortCriteria);
          }
        }
        dv.resultset.filteredrows = colldv.resultset.filteredrows;
        dv.resultset.filterInitialized = colldv.resultset.filterInitialized;

        dv.rematerialize({
          removeWhereFilters: true,
        });
      }

      // Upgrade Logic for binary index refactoring at version 1.5
      if (dbObject.databaseVersion < 1.5) {
        // rebuild all indices
        copyColl.ensureAllIndexes(true);
        copyColl.dirty = true;
      }
    }
  }

  /**
   * Emits `close`. With autosave on and unsaved changes, saves first; the promise resolves after that save.
   */
  close(callback?: (err?: any) => void): Promise<void> {
    let saving: Promise<void> = Promise.resolve();
    // for web use, call it from window.onbeforeunload to save pending changes
    if (this.autosave) {
      this.autosaveDisable();
      if (this.autosaveDirty()) {
        saving = this.saveDatabase(callback);
        callback = undefined;
      }
    }

    this.emit('close');
    // called once: it used to be registered as a permanent 'close' listener
    if (callback) {
      invoke(callback);
    }
    return saving;
  }

  /**-------------------------+
  | Changes API               |
  +--------------------------*/

  /**
   * The Changes API enables the tracking the changes occurred in the collections since the beginning of the session,
   * so it's possible to create a differential dataset for synchronization purposes (possibly to a remote db)
   */

  /**
   * (Changes API) : takes all the changes stored in each
   * collection and creates a single array for the entire database. If an array of names
   * of collections is passed then only the included collections will be tracked.
   *
   * @param arrayOfCollectionNames - optional array of collection names. No arg means all collections are processed.
   * @returns array of changes
   * @see private method createChange() in Collection
   */
  generateChangesNotification(arrayOfCollectionNames?: string[]): any[] {
    function getCollName(coll: Collection) {
      return coll.name;
    }
    let changes: any[] = [];
    const selectedCollections = arrayOfCollectionNames || this.collections.map(getCollName);

    this.collections.forEach((coll) => {
      if (selectedCollections.indexOf(getCollName(coll)) !== -1) {
        changes = changes.concat(coll.getChanges());
      }
    });
    return changes;
  }

  /**
   * (Changes API) - stringify changes for network transmission
   * @returns string representation of the changes
   */
  serializeChanges(collectionNamesArray?: string[]): string {
    return JSON.stringify(this.generateChangesNotification(collectionNamesArray));
  }

  /**
   * (Changes API) : clears all the changes in all collections.
   */
  clearChanges(): void {
    this.collections.forEach((coll) => {
      if (coll.flushChanges) {
        coll.flushChanges();
      }
    });
  }

  /**
   * Resolves once no save is pending (`true`), or `false` if `recursiveWaitLimitDuration` is exceeded.
   * The options object can be passed as first argument.
   */
  throttledSaveDrain(
    callback?: ((success: boolean) => void) | DrainOptions,
    options?: DrainOptions,
  ): Promise<boolean> {
    if (typeof callback === 'object' && callback !== null) {
      options = callback;
      callback = undefined;
    }
    const done = callback as ((success: boolean) => void) | undefined;

    if (!this.throttledSaves || !this.saveQueue.busy) {
      if (done) {
        done(true);
      }
      return Promise.resolve(true);
    }

    const drained = this.saveQueue.drain(options);
    if (!done) {
      return drained;
    }
    return drained.then((success) => {
      invoke(done, success);
      return success;
    });
  }

  /** @deprecated Loads without waiting for pending saves. Use {@link Loki#loadDatabase}. */
  loadDatabaseInternal(options?: any, callback?: (err?: any) => void): Promise<void> {
    return this.settleLoad(loadFromAdapter(this as PersistenceHost, options), callback);
  }

  /**
   * Loads the database through the configured adapter, after pending saves; saves requested while
   * loading run afterwards. `options` also carries the drain options and per-collection `inflate`.
   *
   * @example
   * await db.loadDatabase();
   */
  loadDatabase(options?: any, callback?: (err?: any) => void): Promise<void> {
    return this.settleLoad(this.loadAfterSaves(options), callback);
  }

  private async loadAfterSaves(options?: any): Promise<string> {
    if (!this.throttledSaves) {
      return loadFromAdapter(this as PersistenceHost, options);
    }
    // when idle, the adapter is called in the same tick, as before
    if (this.saveQueue.busy) {
      const drained = await this.saveQueue.drain(options);
      if (!drained || this.saveQueue.busy) {
        throw new Error('Unable to pause save throttling long enough to read database');
      }
    }
    return this.saveQueue.lock(() => loadFromAdapter(this as PersistenceHost, options));
  }

  // as in the original, `loaded` follows the callback; without one it is emitted before the promise resolves
  private settleLoad(loading: Promise<string>, callback?: (err?: any) => void): Promise<void> {
    return this.settleOrWarn(loading, callback, (message) => this.emit('loaded', message));
  }

  /** @deprecated Saves without going through the save queue. Use {@link Loki#saveDatabase}. */
  saveDatabaseInternal(callback?: (err?: any) => void): Promise<void> {
    return this.settleOrWarn(saveToAdapter(this as PersistenceHost), callback);
  }

  /**
   * Saves through the configured adapter. Saves requested while one runs are folded into a single
   * follow-up save (unless `throttledSaves` is false).
   *
   * @example
   * await db.saveDatabase();
   */
  saveDatabase(callback?: (err?: any) => void): Promise<void> {
    return this.settleOrWarn(this.saveQueue.save(), callback);
  }

  /** Deletes the database through the adapter. Also accepts `deleteDatabase(callback)`. */
  deleteDatabase(options?: any, callback?: (err?: any) => void): Promise<void> {
    const done = typeof options === 'function' && !callback ? options : callback;
    return this.settleOrWarn(deleteFromAdapter(this as PersistenceHost), done);
  }

  // a failure without a callback must not crash the process as an unhandled rejection: it is reported
  // as a warning, and callers who await still get the rejection. A throwing listener is rethrown from a timer.
  private settleOrWarn<T = void>(
    promise: Promise<T>,
    callback?: (err?: any) => void,
    onSuccess?: (value: T) => void,
  ): Promise<void> {
    const settled = settle(promise, callback, onSuccess);
    if (!callback) {
      settled.catch((err) => invoke(() => this.emit('warning', err)));
    }
    return settled;
  }

  /**
   * autosaveDirty - check whether any collections are 'dirty' meaning we need to save (entire) database
   *
   * @returns true if database has changed since last autosave, false if not.
   */
  autosaveDirty(): boolean {
    for (let idx = 0; idx < this.collections.length; idx++) {
      if (this.collections[idx].dirty) {
        return true;
      }
    }

    return false;
  }

  /**
   * autosaveClearFlags - resets dirty flags on all collections.
   *    Called from saveDatabase() after db is saved.
   *
   */
  autosaveClearFlags(): void {
    for (let idx = 0; idx < this.collections.length; idx++) {
      this.collections[idx].dirty = false;
    }
  }

  /**
   * autosaveEnable - begin a javascript interval to periodically save the database.
   *
   * @param options - not currently used (remove or allow overrides?)
   * @param callback - (Optional) user supplied async callback
   */
  autosaveEnable(options?: any, callback?: (err?: any) => void): void {
    this.autosave = true;

    let delay = 5000;

    if (typeof this.autosaveInterval !== 'undefined' && this.autosaveInterval !== null) {
      delay = this.autosaveInterval;
    }

    this.autosaveHandle = setInterval(() => {
      if (this.autosaveDirty() && !this.ignoreAutosave) {
        this.saveDatabase(callback);
      }
    }, delay);
  }

  /**
   * autosaveDisable - stop the autosave interval timer.
   *
   */
  autosaveDisable(): void {
    if (typeof this.autosaveHandle !== 'undefined' && this.autosaveHandle !== null) {
      clearInterval(this.autosaveHandle);
      this.autosaveHandle = null;
    }
  }
}

// aliases
export interface Loki {
  toJson: Loki['serialize'];
  save: Loki['saveDatabase'];
}
Loki.prototype.toJson = Loki.prototype.serialize;
Loki.prototype.save = Loki.prototype.saveDatabase;
