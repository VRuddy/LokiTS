// Ported from LokiJS (src/lokijs.js), MIT. Original author: Joe Minichino and LokiJS contributors.
import { LokiFsAdapter } from '../adapters/FsAdapter';
import { LokiLocalStorageAdapter } from '../adapters/LocalStorageAdapter';
import { LokiMemoryAdapter } from '../adapters/MemoryAdapter';
import { LokiEventEmitter } from '../events/EventEmitter';
import type { LokiPersistenceAdapter } from '../types/adapter';
import { deepFreeze } from '../utils/freeze';
import { Utils } from '../utils/helpers';
import { Collection } from './Collection';

/** Options accepted by the Loki constructor and {@link Loki#configureOptions}. */
export interface LokiConfigOptions {
  env?: string;
  verbose?: boolean;
  persistenceMethod?: 'fs' | 'localStorage' | 'memory';
  adapter?: LokiPersistenceAdapter | null;
  autoload?: boolean;
  autoloadCallback?: (err?: any) => void;
  autosave?: boolean;
  autosaveInterval?: number | string;
  autosaveCallback?: (err?: any) => void;
  serializationMethod?: 'normal' | 'pretty' | 'destructured' | string;
  destructureDelimiter?: string;
  throttledSaves?: boolean;
  // biome-ignore lint/suspicious/noExplicitAny: per-collection loader options (proto/inflate) are dynamic
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
// biome-ignore lint/suspicious/noUnsafeDeclarationMerging: alias members (toJson/save) are declared via interface merging per porting contract
export class Loki extends LokiEventEmitter {
  filename!: string;
  collections!: Collection[];
  databaseVersion!: number;
  engineVersion!: number;
  autosave!: boolean;
  autosaveInterval!: number;
  // biome-ignore lint/suspicious/noExplicitAny: timer handle differs between Node and browsers
  autosaveHandle!: any;
  throttledSaves!: boolean;
  options!: LokiConfigOptions;
  persistenceMethod!: string | null | undefined;
  persistenceAdapter!: LokiPersistenceAdapter | null;
  throttledSavePending!: boolean;
  // biome-ignore lint/suspicious/noExplicitAny: callbacks are user supplied
  throttledCallbacks!: any[];
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

    // flags used to throttle saves
    this.throttledSavePending = false;
    this.throttledCallbacks = [];

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
      // biome-ignore lint/suspicious/noExplicitAny: environment globals are untyped
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

  // experimental support for browserify's abstract syntax scan to pick up dependency of indexed adapter.
  // Hopefully, once this hits npm a browserify require of lokijs should scan the main file and detect this indexed adapter reference.
  // biome-ignore lint/suspicious/noExplicitAny: dynamically required adapter module
  getIndexedAdapter(): any {
    // biome-ignore lint/suspicious/noExplicitAny: dynamically required adapter module
    let adapter: any;

    if (typeof require === 'function') {
      adapter = require('../loki-indexed-adapter.js');
    }

    return adapter;
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
    const persistenceMethods: Record<string, new () => LokiPersistenceAdapter> = {
      fs: LokiFsAdapter as unknown as new () => LokiPersistenceAdapter,
      localStorage: LokiLocalStorageAdapter as unknown as new () => LokiPersistenceAdapter,
      memory: LokiMemoryAdapter as unknown as new () => LokiPersistenceAdapter,
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
        this.persistenceAdapter = options.adapter as LokiPersistenceAdapter;
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
    // biome-ignore lint/suspicious/noExplicitAny: a Loki instance is passed as a serialized db object
    databaseCopy.loadJSONObject(this as any, { retainDirtyFlags: true });

    // since our JSON serializeReplacer is not invoked for reference database adapters, this will let us mimic
    if (Object.hasOwn(options, 'removeNonSerializable') && options.removeNonSerializable === true) {
      databaseCopy.autosaveHandle = null;
      databaseCopy.persistenceAdapter = null;

      clen = databaseCopy.collections.length;
      for (idx = 0; idx < clen; idx++) {
        // biome-ignore lint/suspicious/noExplicitAny: nulling non-serializable collection members
        (databaseCopy.collections[idx] as any).constraints = null;
        // biome-ignore lint/suspicious/noExplicitAny: nulling non-serializable collection members
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
  // biome-ignore lint/suspicious/noExplicitAny: collection options and document type are dynamic
  addCollection<T extends object = any>(name: string, options?: any): Collection<T> {
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
  // biome-ignore lint/suspicious/noExplicitAny: document type is dynamic
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
  // biome-ignore lint/suspicious/noExplicitAny: document type is dynamic
  renameCollection<T extends object = any>(oldName: string, newName: string): Collection<T> | null {
    const c = this.getCollection<T>(oldName);

    if (c) {
      c.name = newName;
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
        // biome-ignore lint/suspicious/noExplicitAny: objType is a collection internal
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
        // biome-ignore lint/suspicious/noExplicitAny: copying arbitrary own properties
        const curcol = this.collections[i] as any;
        for (const prop in curcol) {
          // biome-ignore lint/suspicious/noExplicitAny: copying arbitrary own properties
          if (Object.hasOwn(curcol, prop) && Object.hasOwn(tmpcol, prop)) {
            // biome-ignore lint/suspicious/noExplicitAny: copying arbitrary own properties
            curcol[prop] = (tmpcol as any)[prop];
          }
        }
        this.collections.splice(i, 1);
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
  // biome-ignore lint/suspicious/noExplicitAny: JSON.stringify replacer signature
  serializeReplacer(key: string, value: any): any {
    switch (key) {
      case 'autosaveHandle':
      case 'persistenceAdapter':
      case 'constraints':
      case 'ttl':
        return null;
      case 'throttledSavePending':
      case 'throttledCallbacks':
        return undefined;
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
    // biome-ignore lint/suspicious/noExplicitAny: result is string or string[] depending on options
    let result: any;
    let resultlen: number;
    // biome-ignore lint/suspicious/noExplicitAny: elements are strings or string arrays depending on options
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
    // biome-ignore lint/suspicious/noExplicitAny: a Loki instance is passed as a serialized db object
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
    // biome-ignore lint/suspicious/noExplicitAny: string or array depending on options
    destructuredSource: any,
    options?: {
      partitioned?: boolean;
      partition?: number;
      delimited?: boolean;
      delimiter?: string;
    },
    // biome-ignore lint/suspicious/noExplicitAny: parsed database object
  ): any {
    // biome-ignore lint/suspicious/noExplicitAny: string or array depending on options
    let workarray: any = [];
    let len: number;
    // biome-ignore lint/suspicious/noExplicitAny: parsed database object
    let cdb: any;
    let collIndex = 0;
    let collCount: number;
    let lineIndex = 1;
    let done = false;
    // biome-ignore lint/suspicious/noExplicitAny: parsed JSON line
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
    // biome-ignore lint/suspicious/noExplicitAny: string or array depending on options
    destructuredSource: any,
    options?: {
      partitioned?: boolean;
      delimited?: boolean;
      delimiter?: string;
      collectionIndex?: number;
      partition?: number;
    },
    // biome-ignore lint/suspicious/noExplicitAny: array of documents
  ): any[] {
    // biome-ignore lint/suspicious/noExplicitAny: array of strings then documents
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
  // biome-ignore lint/suspicious/noExplicitAny: per-collection loader options are dynamic
  loadJSON(serializedDb: string, options?: any): void {
    // biome-ignore lint/suspicious/noExplicitAny: parsed database object
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
  // biome-ignore lint/suspicious/noExplicitAny: dbObject is a parsed (or Loki) object, options are dynamic
  loadJSONObject(dbObject: any, options?: any): void {
    let i = 0;
    const len = dbObject.collections ? dbObject.collections.length : 0;
    // biome-ignore lint/suspicious/noExplicitAny: serialized collection object
    let coll: any;
    // biome-ignore lint/suspicious/noExplicitAny: collection internals are assigned dynamically
    let copyColl: any;
    let clen: number;
    let j: number;
    // biome-ignore lint/suspicious/noExplicitAny: user supplied loader
    let loader: any;
    // biome-ignore lint/suspicious/noExplicitAny: user supplied loader result
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

    // biome-ignore lint/suspicious/noExplicitAny: serialized collection object
    function makeLoader(coll: any) {
      const collOptions = options[coll.name];
      // biome-ignore lint/suspicious/noExplicitAny: user supplied inflater
      let inflater: any;

      if (collOptions.proto) {
        inflater = collOptions.inflate || Utils.copyProperties;

        // biome-ignore lint/suspicious/noExplicitAny: user data
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
        Object.defineProperty(copyColl, 'data', {
          get: function (this: { getData: (() => unknown) | null }) {
            const data = this.getData?.();
            this.getData = null;
            Object.defineProperty(this, 'data', { value: data });
            return data;
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
   * Emits the close event. In autosave scenarios, if the database is dirty, this will save and disable timer.
   * Does not actually destroy the db.
   *
   * @param callback - (Optional) if supplied will be registered with close event before emitting.
   */
  // biome-ignore lint/suspicious/noExplicitAny: user supplied callback
  close(callback?: (err?: any) => void): void {
    // for autosave scenarios, we will let close perform final save (if dirty)
    // For web use, you might call from window.onbeforeunload to shutdown database, saving pending changes
    if (this.autosave) {
      this.autosaveDisable();
      if (this.autosaveDirty()) {
        this.saveDatabase(callback);
        callback = undefined;
      }
    }

    if (callback) {
      this.on('close', callback);
    }
    this.emit('close');
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
  // biome-ignore lint/suspicious/noExplicitAny: change objects are dynamic
  generateChangesNotification(arrayOfCollectionNames?: string[]): any[] {
    function getCollName(coll: Collection) {
      return coll.name;
    }
    // biome-ignore lint/suspicious/noExplicitAny: change objects are dynamic
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
   * Wait for throttledSaves to complete and invoke your callback when drained or duration is met.
   *
   * @param callback - callback to fire when save queue is drained, it is passed a sucess parameter value
   * @param options - configuration options
   * @param options.recursiveWait - (default: true) if after queue is drained, another save was kicked off, wait for it
   * @param options.recursiveWaitLimit - (default: false) limit our recursive waiting to a duration
   * @param options.recursiveWaitLimitDelay - (default: 2000) cutoff in ms to stop recursively re-draining
   */
  throttledSaveDrain(
    callback: (success: boolean) => void,
    options?: {
      recursiveWait?: boolean;
      recursiveWaitLimit?: boolean;
      recursiveWaitLimitDuration?: number;
      started?: number;
      // biome-ignore lint/suspicious/noExplicitAny: options object is shared with loadDatabase options
      [key: string]: any;
    },
  ): void {
    const now = new Date().getTime();

    if (!this.throttledSaves) {
      callback(true);
    }

    options = options || {};
    if (!Object.hasOwn(options, 'recursiveWait')) {
      options.recursiveWait = true;
    }
    if (!Object.hasOwn(options, 'recursiveWaitLimit')) {
      options.recursiveWaitLimit = false;
    }
    if (!Object.hasOwn(options, 'recursiveWaitLimitDuration')) {
      options.recursiveWaitLimitDuration = 2000;
    }
    if (!Object.hasOwn(options, 'started')) {
      options.started = new Date().getTime();
    }
    const opts = options;

    // if save is pending
    if (this.throttledSaves && this.throttledSavePending) {
      // if we want to wait until we are in a state where there are no pending saves at all
      if (opts.recursiveWait) {
        // queue the following meta callback for when it completes
        this.throttledCallbacks.push(() => {
          // if there is now another save pending...
          if (this.throttledSavePending) {
            // if we wish to wait only so long and we have exceeded limit of our waiting, callback with false success value
            if (
              opts.recursiveWaitLimit &&
              now - (opts.started as number) > (opts.recursiveWaitLimitDuration as number)
            ) {
              callback(false);
              return;
            }
            // it must be ok to wait on next queue drain
            this.throttledSaveDrain(callback, opts);
            return;
          }
          // no pending saves so callback with true success
          callback(true);
          return;
        });
      }
      // just notify when current queue is depleted
      else {
        this.throttledCallbacks.push(callback);
        return;
      }
    }
    // no save pending, just callback
    else {
      callback(true);
    }
  }

  /**
   * Internal load logic, decoupled from throttling/contention logic
   *
   * @param options - not currently used (remove or allow overrides?)
   * @param callback - (Optional) user supplied async callback / error handler
   */
  // biome-ignore lint/suspicious/noExplicitAny: callback receives errors of any shape
  loadDatabaseInternal(options?: any, callback?: (err?: any) => void): void {
    // biome-ignore lint/suspicious/noExplicitAny: callback receives errors of any shape
    const cFun =
      callback ||
      // biome-ignore lint/suspicious/noExplicitAny: callback receives errors of any shape
      ((err?: any, _data?: any) => {
        if (err) {
          throw err;
        }
      });
    const self = this;

    // the persistenceAdapter should be present if all is ok, but check to be sure.
    if (this.persistenceAdapter !== null) {
      // biome-ignore lint/suspicious/noExplicitAny: adapters may return string, object, Error or null
      this.persistenceAdapter.loadDatabase(
        this.filename,
        function loadDatabaseCallback(dbString: any) {
          if (typeof dbString === 'string') {
            let parseSuccess = false;
            try {
              self.loadJSON(dbString, options || {});
              parseSuccess = true;
            } catch (err) {
              cFun(err);
            }
            if (parseSuccess) {
              cFun(null);
              self.emit('loaded', `database ${self.filename} loaded`);
            }
          } else {
            // falsy result means new database
            if (!dbString) {
              cFun(null);
              self.emit('loaded', `empty database ${self.filename} loaded`);
              return;
            }

            // instanceof error means load faulted
            if (dbString instanceof Error) {
              cFun(dbString);
              return;
            }

            // if adapter has returned an js object (other than null or error) attempt to load from JSON object
            if (typeof dbString === 'object') {
              self.loadJSONObject(dbString, options || {});
              cFun(null); // return null on success
              self.emit('loaded', `database ${self.filename} loaded`);
              return;
            }

            cFun(`unexpected adapter response : ${dbString}`);
          }
        },
      );
    } else {
      cFun(new Error('persistenceAdapter not configured'));
    }
  }

  /**
   * Handles manually loading from file system, local storage, or adapter (such as indexeddb)
   *    This method utilizes loki configuration options (if provided) to determine which
   *    persistence method to use, or environment detection (if configuration was not provided).
   *    To avoid contention with any throttledSaves, we will drain the save queue first.
   *
   * If you are configured with autosave, you do not need to call this method yourself.
   *
   * @param options - if throttling saves and loads, this controls how we drain save queue before loading
   * @param options.recursiveWait - (default: true) wait recursively until no saves are queued
   * @param options.recursiveWaitLimit - (default: false) limit our recursive waiting to a duration
   * @param options.recursiveWaitLimitDelay - (default: 2000) cutoff in ms to stop recursively re-draining
   * @param callback - (Optional) user supplied async callback / error handler
   * @example
   * db.loadDatabase({}, function(err) {
   *   if (err) {
   *     console.log("error : " + err);
   *   }
   *   else {
   *     console.log("database loaded.");
   *   }
   * });
   */
  // biome-ignore lint/suspicious/noExplicitAny: callback receives errors of any shape
  loadDatabase(options?: any, callback?: (err?: any) => void): void {
    // if throttling disabled, just call internal
    if (!this.throttledSaves) {
      this.loadDatabaseInternal(options, callback);
      return;
    }

    // try to drain any pending saves in the queue to lock it for loading
    this.throttledSaveDrain((success) => {
      if (success) {
        // pause/throttle saving until loading is done
        this.throttledSavePending = true;

        this.loadDatabaseInternal(options, (err) => {
          // now that we are finished loading, if no saves were throttled, disable flag
          if (this.throttledCallbacks.length === 0) {
            this.throttledSavePending = false;
          }
          // if saves requests came in while loading, kick off new save to kick off resume saves
          else {
            this.saveDatabase();
          }

          if (typeof callback === 'function') {
            callback(err);
          }
        });
        return;
      }
      if (typeof callback === 'function') {
        callback(new Error('Unable to pause save throttling long enough to read database'));
      }
    }, options);
  }

  /**
   * Internal save logic, decoupled from save throttling logic
   */
  // biome-ignore lint/suspicious/noExplicitAny: callback receives errors of any shape
  saveDatabaseInternal(callback?: (err?: any) => void): void {
    // biome-ignore lint/suspicious/noExplicitAny: callback receives errors of any shape
    const cFun =
      callback ||
      // biome-ignore lint/suspicious/noExplicitAny: callback receives errors of any shape
      ((err?: any) => {
        if (err) {
          throw err;
        }
        return;
      });
    const self = this;

    // the persistenceAdapter should be present if all is ok, but check to be sure.
    if (!this.persistenceAdapter) {
      cFun(new Error('persistenceAdapter not configured'));
      return;
    }

    // biome-ignore lint/suspicious/noExplicitAny: adapter contract is mode dependent
    const adapter = this.persistenceAdapter as any;

    // run incremental, reference, or normal mode adapters, depending on what's available
    if (adapter.mode === 'incremental') {
      let cachedDirty: [boolean, number[]][] | undefined;
      // ignore autosave until we copy loki (only then we can clear dirty flags,
      // but if we don't do it now, autosave will be triggered a lot unnecessarily)
      this.ignoreAutosave = true;
      adapter.saveDatabase(
        this.filename,
        function getLokiCopy() {
          self.ignoreAutosave = false;
          if (cachedDirty) {
            cFun(new Error('adapter error - getLokiCopy called more than once'));
            return;
          }
          const lokiCopy = self.copy({ removeNonSerializable: true });

          // remember and clear dirty ids -- we must do it before the save so that if
          // and update occurs between here and callback, it will get saved later
          cachedDirty = self.collections.map((collection) => {
            // biome-ignore lint/suspicious/noExplicitAny: dirty tracking internals
            return [collection.dirty, (collection as any).dirtyIds] as [boolean, number[]];
          });
          self.collections.forEach((col) => {
            col.dirty = false;
            // biome-ignore lint/suspicious/noExplicitAny: dirty tracking internals
            (col as any).dirtyIds = [];
          });
          return lokiCopy;
        },
        // biome-ignore lint/suspicious/noExplicitAny: callback receives errors of any shape
        function exportDatabaseCallback(err?: any) {
          self.ignoreAutosave = false;
          if (err && cachedDirty) {
            const cd = cachedDirty;
            // roll back dirty IDs to be saved later
            self.collections.forEach((col, i) => {
              const cached = cd[i];
              col.dirty = col.dirty || cached[0];
              // biome-ignore lint/suspicious/noExplicitAny: dirty tracking internals
              (col as any).dirtyIds = (col as any).dirtyIds.concat(cached[1]);
            });
          }
          cFun(err);
        },
      );
    } else if (adapter.mode === 'reference' && typeof adapter.exportDatabase === 'function') {
      // TODO: dirty should be cleared here
      // filename may seem redundant but loadDatabase will need to expect this same filename
      adapter.exportDatabase(
        this.filename,
        this.copy({ removeNonSerializable: true }),
        // biome-ignore lint/suspicious/noExplicitAny: callback receives errors of any shape
        function exportDatabaseCallback(err?: any) {
          self.autosaveClearFlags();
          cFun(err);
        },
      );
    }
    // otherwise just pass the serialized database to adapter
    else {
      // persistenceAdapter might be asynchronous, so we must clear `dirty` immediately
      // or autosave won't work if an update occurs between here and the callback
      // TODO: This should be stored and rolled back in case of DB save failure
      this.autosaveClearFlags();
      // biome-ignore lint/suspicious/noExplicitAny: callback receives errors of any shape
      adapter.saveDatabase(
        this.filename,
        this.serialize(),
        function saveDatabasecallback(err?: any) {
          cFun(err);
        },
      );
    }
  }

  /**
   * Handles manually saving to file system, local storage, or adapter (such as indexeddb)
   *    This method utilizes loki configuration options (if provided) to determine which
   *    persistence method to use, or environment detection (if configuration was not provided).
   *
   * If you are configured with autosave, you do not need to call this method yourself.
   *
   * @param callback - (Optional) user supplied async callback / error handler
   * @example
   * db.saveDatabase(function(err) {
   *   if (err) {
   *     console.log("error : " + err);
   *   }
   *   else {
   *     console.log("database saved.");
   *   }
   * });
   */
  // biome-ignore lint/suspicious/noExplicitAny: callback receives errors of any shape
  saveDatabase(callback?: (err?: any) => void): void {
    if (!this.throttledSaves) {
      this.saveDatabaseInternal(callback);
      return;
    }

    if (this.throttledSavePending) {
      this.throttledCallbacks.push(callback);
      return;
    }

    const localCallbacks = this.throttledCallbacks;
    this.throttledCallbacks = [];
    localCallbacks.unshift(callback);
    this.throttledSavePending = true;
    this.saveDatabaseInternal((err) => {
      this.throttledSavePending = false;
      localCallbacks.forEach((pcb) => {
        if (typeof pcb === 'function') {
          // Queue the callbacks so we first finish this method execution
          setTimeout(() => {
            pcb(err);
          }, 1);
        }
      });

      // since this is called async, future requests may have come in, if so.. kick off next save
      if (this.throttledCallbacks.length > 0) {
        this.saveDatabase();
      }
    });
  }

  /**
   * Handles deleting a database from file system, local
   *    storage, or adapter (indexeddb)
   *    This method utilizes loki configuration options (if provided) to determine which
   *    persistence method to use, or environment detection (if configuration was not provided).
   *
   * @param callback - (Optional) user supplied async callback / error handler
   */
  deleteDatabase(
    // biome-ignore lint/suspicious/noExplicitAny: options is unused; may be the callback itself
    options?: any,
    // biome-ignore lint/suspicious/noExplicitAny: callback receives errors of any shape
    callback?: (err?: any) => void,
  ): void {
    // biome-ignore lint/suspicious/noExplicitAny: callback receives errors of any shape
    let cFun: (err?: any, data?: any) => void =
      callback ||
      // biome-ignore lint/suspicious/noExplicitAny: callback receives errors of any shape
      ((err?: any, _data?: any) => {
        if (err) {
          throw err;
        }
      });

    // we aren't even using options, so we will support syntax where
    // callback is passed as first and only argument
    if (typeof options === 'function' && !callback) {
      cFun = options;
    }

    // the persistenceAdapter should be present if all is ok, but check to be sure.
    if (this.persistenceAdapter !== null) {
      // biome-ignore lint/suspicious/noExplicitAny: callback receives errors of any shape
      (this.persistenceAdapter as any).deleteDatabase(
        this.filename,
        // biome-ignore lint/suspicious/noExplicitAny: callback receives errors of any shape
        function deleteDatabaseCallback(err?: any) {
          cFun(err);
        },
      );
    } else {
      cFun(new Error('persistenceAdapter not configured'));
    }
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
  // biome-ignore lint/suspicious/noExplicitAny: options unused; callback receives errors of any shape
  autosaveEnable(options?: any, callback?: (err?: any) => void): void {
    this.autosave = true;

    let delay = 5000;
    const self = this;

    if (typeof this.autosaveInterval !== 'undefined' && this.autosaveInterval !== null) {
      delay = this.autosaveInterval;
    }

    this.autosaveHandle = setInterval(function autosaveHandleInterval() {
      // use of dirty flag will need to be hierarchical since mods are done at collection level with no visibility of 'db'
      // so next step will be to implement collection level dirty flags set on insert/update/remove
      // along with loki level isdirty() function which iterates all collections to see if any are dirty

      if (self.autosaveDirty() && !self.ignoreAutosave) {
        self.saveDatabase(callback);
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
