// Ported from LokiJS (src/lokijs.js), MIT. Original author: Joe Minichino and LokiJS contributors.
import { LokiEventEmitter } from '../events/EventEmitter';
import { DynamicView } from '../indexing/DynamicView';
import { ExactIndex } from '../indexing/ExactIndex';
import { UniqueIndex } from '../indexing/UniqueIndex';
import { Comparators } from '../query/comparators';
import { LokiOps } from '../query/operators';
import { Resultset } from '../query/Resultset';
import type { LokiDocument } from '../types/document';
import type { LokiQuery } from '../types/query';
import { type CloneMethod, clone } from '../utils/clone';
import { deepFreeze, freeze, unFreeze } from '../utils/freeze';
import {
  average,
  deepProperty,
  isDeepProperty,
  parseBase10,
  standardDeviation,
  sub,
  Utils,
} from '../utils/helpers';

const hasOwn = Object.prototype.hasOwnProperty;

/** A binary index definition held by a collection (serialized with the collection). */
export interface CollectionBinaryIndex {
  name: string;
  dirty: boolean;
  values: number[];
}

/** Options accepted by the {@link Collection} constructor. */
export interface CollectionOptions {
  unique?: string | string[];
  exact?: string[];
  indices?: string | string[];
  adaptiveBinaryIndices?: boolean;
  transactional?: boolean;
  asyncListeners?: boolean;
  disableMeta?: boolean;
  disableChangesApi?: boolean;
  disableDeltaChangesApi?: boolean;
  autoupdate?: boolean;
  clone?: boolean;
  serializableIndices?: boolean;
  disableFreeze?: boolean;
  cloneMethod?: CloneMethod;
  ttl?: number;
  ttlInterval?: number;
  // biome-ignore lint/suspicious/noExplicitAny: other (loader provided) options are tolerated
  [key: string]: any;
}

/** Options accepted by {@link Collection#checkIndex} and {@link Collection#checkAllIndexes}. */
export interface CheckIndexOptions {
  randomSampling?: boolean;
  randomSamplingFactor?: number;
  repair?: boolean;
}

/** An entry of the changes api log. */
export interface CollectionChange {
  name: string;
  operation: string;
  // biome-ignore lint/suspicious/noExplicitAny: change payload is a (delta) clone of a document
  obj: any;
}

/**
 * Collection class that handles documents of same type
 * @implements LokiEventEmitter
 * @param name - collection name
 * @param options - (optional) array of property names to be indicized OR a configuration object
 * @param options.unique - array of property names to define unique constraints for
 * @param options.exact - array of property names to define exact constraints for
 * @param options.indices - array property names to define binary indexes for
 * @param options.adaptiveBinaryIndices - collection indices will be actively rebuilt rather than lazily
 * @param options.asyncListeners - whether listeners are invoked asynchronously
 * @param options.disableMeta - set to true to disable meta property on documents
 * @param options.disableChangesApi - set to false to enable Changes API
 * @param options.disableDeltaChangesApi - set to false to enable Delta Changes API (requires Changes API, forces cloning)
 * @param options.autoupdate - use Object.observe to update objects automatically
 * @param options.clone - specify whether inserts and queries clone to/from user
 * @param options.serializableIndices - converts date values on binary indexed properties to epoch time
 * @param options.disableFreeze - when false all docs are frozen
 * @param options.cloneMethod - 'parse-stringify', 'jquery-extend-deep', 'shallow', 'shallow-assign'
 * @param options.ttl - age of document (in ms.) before document is considered aged/stale.
 * @param options.ttlInterval - time interval for clearing out 'aged' documents; not set by default.
 * @see {@link Loki#addCollection} for normal creation of collections
 */
// biome-ignore lint/suspicious/noExplicitAny: documents are dynamic by nature
export class Collection<T extends object = any> extends LokiEventEmitter {
  // the name of the collection
  name!: string;
  // the data held by the collection
  data!: LokiDocument<T>[];
  idIndex!: number[] | null;
  binaryIndices!: Record<string, CollectionBinaryIndex>;
  constraints!: {
    unique: Record<string, UniqueIndex>;
    exact: Record<string, ExactIndex>;
  };
  uniqueNames!: string[];
  // biome-ignore lint/suspicious/noExplicitAny: transform steps are free-form
  transforms!: Record<string, any>;
  objType!: string;
  dirty!: boolean;
  // biome-ignore lint/suspicious/noExplicitAny: cached copies of internal data
  cachedIndex!: any;
  // biome-ignore lint/suspicious/noExplicitAny: cached copies of internal data
  cachedBinaryIndex!: any;
  // biome-ignore lint/suspicious/noExplicitAny: cached copies of internal data
  cachedData!: any;
  // biome-ignore lint/suspicious/noExplicitAny: set by transactions only
  cachedDirtyIds?: any;
  /** set by the owning database (incremental persistence mode) */
  isIncremental?: boolean;
  adaptiveBinaryIndices!: boolean;
  transactional!: boolean;
  cloneObjects!: boolean;
  cloneMethod!: CloneMethod;
  disableMeta!: boolean;
  disableChangesApi!: boolean;
  disableDeltaChangesApi!: boolean;
  autoupdate!: boolean;
  serializableIndices!: boolean;
  disableFreeze!: boolean;
  ttl!: {
    age: number | null;
    ttlInterval: number | null | undefined;
    // biome-ignore lint/suspicious/noExplicitAny: timer handle (platform dependent)
    daemon: any;
  };
  maxId!: number;
  // biome-ignore lint/suspicious/noExplicitAny: dynamic views of any document type
  DynamicViews!: DynamicView<any>[];
  changes!: CollectionChange[];
  dirtyIds!: number[];
  // biome-ignore lint/suspicious/noExplicitAny: shape of Object.observe callback changes
  observerCallback!: (changes: any[]) => void;
  // biome-ignore lint/suspicious/noExplicitAny: delta of dynamic objects
  getChangeDelta!: (obj: any, old: any) => any;
  // biome-ignore lint/suspicious/noExplicitAny: delta of dynamic objects
  getObjectDelta!: (oldObject: any, newObject: any) => any;
  flushChanges!: () => void;
  getChanges!: () => CollectionChange[];
  setChangesApi!: (enabled: boolean) => void;

  // shared on the prototype (see assignments after the class)
  lokiConsoleWrapper!: {
    log: (...args: unknown[]) => void;
    warn: (...args: unknown[]) => void;
    error: (...args: unknown[]) => void;
  };
  // biome-ignore lint/suspicious/noExplicitAny: staged copies of documents
  stages!: Record<string, Record<string, any>>;
  // biome-ignore lint/suspicious/noExplicitAny: commit log entries
  commitLog!: any[];

  constructor(name: string, options?: CollectionOptions) {
    super();

    // the name of the collection

    this.name = name;
    // the data held by the collection
    this.data = [];
    this.idIndex = null; // position->$loki index (built lazily)
    this.binaryIndices = {}; // user defined indexes
    this.constraints = {
      unique: {},
      exact: {},
    };

    // unique contraints contain duplicate object references, so they are not persisted.
    // we will keep track of properties which have unique contraint applied here, and regenerate lazily
    this.uniqueNames = [];

    // transforms will be used to store frequently used query chains as a series of steps
    // which itself can be stored along with the database.
    this.transforms = {};

    // the object type of the collection
    this.objType = name;

    // in autosave scenarios we will use collection level dirty flags to determine whether save is needed.
    // currently, if any collection is dirty we will autosave the whole database if autosave is configured.
    // defaulting to true since this is called from addCollection and adding a collection should trigger save
    this.dirty = true;

    // private holders for cached data
    this.cachedIndex = null;
    this.cachedBinaryIndex = null;
    this.cachedData = null;
    const self = this;

    /* OPTIONS */
    const opts: CollectionOptions = options || {};

    // exact match and unique constraints
    if (Object.hasOwn(opts, 'unique')) {
      if (!Array.isArray(opts.unique)) {
        opts.unique = [opts.unique as string];
      }
      // save names; actual index is built lazily
      opts.unique.forEach((prop: string) => {
        self.uniqueNames.push(prop);
      });
    }

    if (Object.hasOwn(opts, 'exact')) {
      (opts.exact as string[]).forEach((prop: string) => {
        self.constraints.exact[prop] = new ExactIndex(prop);
      });
    }

    // if set to true we will optimally keep indices 'fresh' during insert/update/remove ops (never dirty/never needs rebuild)
    // if you frequently intersperse insert/update/remove ops between find ops this will likely be significantly faster option.
    this.adaptiveBinaryIndices = Object.hasOwn(opts, 'adaptiveBinaryIndices')
      ? (opts.adaptiveBinaryIndices as boolean)
      : true;

    // is collection transactional
    this.transactional = Object.hasOwn(opts, 'transactional')
      ? (opts.transactional as boolean)
      : false;

    // options to clone objects when inserting them
    this.cloneObjects = Object.hasOwn(opts, 'clone') ? (opts.clone as boolean) : false;

    // default clone method (if enabled) is parse-stringify
    this.cloneMethod = Object.hasOwn(opts, 'cloneMethod')
      ? (opts.cloneMethod as CloneMethod)
      : 'parse-stringify';

    // option to make event listeners async, default is sync
    this.asyncListeners = Object.hasOwn(opts, 'asyncListeners')
      ? (opts.asyncListeners as boolean)
      : false;

    // if set to true we will not maintain a meta property for a document
    this.disableMeta = Object.hasOwn(opts, 'disableMeta') ? (opts.disableMeta as boolean) : false;

    // disable track changes
    this.disableChangesApi = Object.hasOwn(opts, 'disableChangesApi')
      ? (opts.disableChangesApi as boolean)
      : true;

    // disable delta update object style on changes
    this.disableDeltaChangesApi = Object.hasOwn(opts, 'disableDeltaChangesApi')
      ? (opts.disableDeltaChangesApi as boolean)
      : true;
    if (this.disableChangesApi) {
      this.disableDeltaChangesApi = true;
    }

    // option to observe objects and update them automatically, ignored if Object.observe is not supported
    this.autoupdate = Object.hasOwn(opts, 'autoupdate') ? (opts.autoupdate as boolean) : false;

    // by default, if you insert a document into a collection with binary indices, if those indexed properties contain
    // a DateTime we will convert to epoch time format so that (across serializations) its value position will be the
    // same 'after' serialization as it was 'before'.
    this.serializableIndices = Object.hasOwn(opts, 'serializableIndices')
      ? (opts.serializableIndices as boolean)
      : true;

    // option to deep freeze all documents
    this.disableFreeze = Object.hasOwn(opts, 'disableFreeze')
      ? (opts.disableFreeze as boolean)
      : true;

    //option to activate a cleaner daemon - clears "aged" documents at set intervals.
    this.ttl = {
      age: null,
      ttlInterval: null,
      daemon: null,
    };
    this.setTTL(opts.ttl || -1, opts.ttlInterval as number);

    // currentMaxId - change manually at your own peril!
    this.maxId = 0;

    this.DynamicViews = [];

    // events
    this.events = {
      insert: [],
      update: [],
      'pre-insert': [],
      'pre-update': [],
      close: [],
      flushbuffer: [],
      error: [],
      delete: [],
      warning: [],
    };

    // changes are tracked by collection and aggregated by the db
    this.changes = [];

    // lightweight changes tracking (loki IDs only) for optimized db saving
    this.dirtyIds = [];

    // initialize optional user-supplied indices array ['age', 'lname', 'zip']
    let indices: string[] = [];
    if (opts?.indices) {
      if (Object.prototype.toString.call(opts.indices) === '[object Array]') {
        indices = opts.indices as string[];
      } else if (typeof opts.indices === 'string') {
        indices = [opts.indices];
      } else {
        throw new TypeError('Indices needs to be a string or an array of strings');
      }
    }

    for (let idx = 0; idx < indices.length; idx++) {
      this.ensureIndex(indices[idx]);
    }

    // biome-ignore lint/suspicious/noExplicitAny: shape of Object.observe callback changes
    function observerCallback(changes: any[]) {
      // biome-ignore lint/suspicious/noExplicitAny: Set of observed objects (or array fallback)
      const changedObjects: any = typeof Set === 'function' ? new Set() : [];

      if (!changedObjects.add)
        // biome-ignore lint/suspicious/noExplicitAny: array based Set fallback
        changedObjects.add = function (this: any, object: any) {
          if (this.indexOf(object) === -1) this.push(object);
          return this;
        };

      // biome-ignore lint/suspicious/noExplicitAny: observed change record
      changes.forEach((change: any) => {
        changedObjects.add(change.object);
      });

      // biome-ignore lint/suspicious/noExplicitAny: observed document
      changedObjects.forEach((object: any) => {
        if (!hasOwn.call(object, '$loki')) {
          self.removeAutoUpdateObserver(object);
          return;
        }
        try {
          self.update(object);
        } catch (err) {}
      });
    }

    this.observerCallback = observerCallback;

    //Compare changed object (which is a forced clone) with existing object and return the delta
    // biome-ignore lint/suspicious/noExplicitAny: dynamic objects
    function getChangeDelta(obj: any, old: any) {
      if (old) {
        return getObjectDelta(old, obj);
      }
      return JSON.parse(JSON.stringify(obj));
    }

    this.getChangeDelta = getChangeDelta;

    // biome-ignore lint/suspicious/noExplicitAny: dynamic objects
    function getObjectDelta(oldObject: any, newObject: any): any {
      const propertyNames =
        newObject !== null && typeof newObject === 'object' ? Object.keys(newObject) : null;
      if (propertyNames?.length && ['string', 'boolean', 'number'].indexOf(typeof newObject) < 0) {
        // biome-ignore lint/suspicious/noExplicitAny: delta is a dynamic object
        const delta: any = {};
        for (let i = 0; i < propertyNames.length; i++) {
          const propertyName = propertyNames[i];
          if (Object.hasOwn(newObject, propertyName)) {
            if (
              !Object.hasOwn(oldObject, propertyName) ||
              self.uniqueNames.indexOf(propertyName) >= 0 ||
              propertyName === '$loki' ||
              propertyName === 'meta'
            ) {
              delta[propertyName] = newObject[propertyName];
            } else {
              const propertyDelta = getObjectDelta(
                oldObject[propertyName],
                newObject[propertyName],
              );
              // biome-ignore lint/suspicious/noDoubleEquals: original quirk, `!= {}` is always true
              // biome-ignore lint/suspicious/noExplicitAny: see above
              if (typeof propertyDelta !== 'undefined' && propertyDelta != ({} as any)) {
                delta[propertyName] = propertyDelta;
              }
            }
          }
        }
        return Object.keys(delta).length === 0 ? undefined : delta;
      }
      return oldObject === newObject ? undefined : newObject;
    }

    this.getObjectDelta = getObjectDelta;

    // clear all the changes
    function flushChanges() {
      self.changes = [];
    }

    this.getChanges = () => {
      return self.changes;
    };

    this.flushChanges = flushChanges;

    this.setChangesApi = (enabled: boolean) => {
      self.disableChangesApi = !enabled;
      if (!enabled) {
        self.disableDeltaChangesApi = false;
      }
    };

    // biome-ignore lint/suspicious/noExplicitAny: deleted document
    this.on('delete', function deleteCallback(obj: any) {
      if (!self.disableChangesApi) {
        self.createChange(self.name, 'R', obj);
      }
    });

    this.on('warning', (warning: unknown) => {
      self.lokiConsoleWrapper.warn(warning);
    });
    // for de-serialization purposes
    flushChanges();
  }

  /*
   * For ChangeAPI default to clone entire object, for delta changes create object with only differences (+ $loki and meta)
   */
  // biome-ignore lint/suspicious/noExplicitAny: dynamic objects
  createChange(name: string, op: string, obj: any, old?: any) {
    this.changes.push({
      name: name,
      operation: op,
      obj:
        op === 'U' && !this.disableDeltaChangesApi
          ? this.getChangeDelta(obj, old)
          : JSON.parse(JSON.stringify(obj)),
    });
  }

  // biome-ignore lint/suspicious/noExplicitAny: object or array of objects to give meta to
  insertMeta(obj: any) {
    let len: number;
    let idx: number;

    if (this.disableMeta || !obj) {
      return;
    }

    // if batch insert
    if (Array.isArray(obj)) {
      len = obj.length;

      for (idx = 0; idx < len; idx++) {
        if (!Object.hasOwn(obj[idx], 'meta')) {
          obj[idx].meta = {};
        }

        obj[idx].meta.created = new Date().getTime();
        obj[idx].meta.revision = 0;
      }

      return;
    }

    // single object
    if (!obj.meta) {
      obj.meta = {};
    }

    obj.meta.created = new Date().getTime();
    obj.meta.revision = 0;
  }

  // biome-ignore lint/suspicious/noExplicitAny: dynamic object
  updateMeta(obj: any, _objFrozen?: any): any {
    if (this.disableMeta || !obj) {
      return obj;
    }
    if (!this.disableFreeze) {
      obj = unFreeze(obj);
      obj.meta = unFreeze(obj.meta);
    }
    obj.meta.updated = new Date().getTime();
    obj.meta.revision += 1;
    return obj;
  }

  // biome-ignore lint/suspicious/noExplicitAny: dynamic object
  createInsertChange(obj: any) {
    this.createChange(this.name, 'I', obj);
  }

  // biome-ignore lint/suspicious/noExplicitAny: dynamic objects
  createUpdateChange(obj: any, old: any) {
    this.createChange(this.name, 'U', obj, old);
  }

  // biome-ignore lint/suspicious/noExplicitAny: dynamic object
  insertMetaWithChange(obj: any) {
    this.insertMeta(obj);
    this.createInsertChange(obj);
  }

  // biome-ignore lint/suspicious/noExplicitAny: dynamic objects
  updateMetaWithChange(obj: any, old: any, objFrozen?: any): any {
    obj = this.updateMeta(obj, objFrozen);
    this.createUpdateChange(obj, old);
    return obj;
  }

  // biome-ignore lint/suspicious/noExplicitAny: dynamic object
  addAutoUpdateObserver(object: any) {
    // biome-ignore lint/suspicious/noExplicitAny: Object.observe is not in lib typings
    const ObjectAny = Object as any;
    if (!this.autoupdate || typeof ObjectAny.observe !== 'function') return;

    ObjectAny.observe(object, this.observerCallback, [
      'add',
      'update',
      'delete',
      'reconfigure',
      'setPrototype',
    ]);
  }

  // biome-ignore lint/suspicious/noExplicitAny: dynamic object
  removeAutoUpdateObserver(object: any) {
    // biome-ignore lint/suspicious/noExplicitAny: Object.observe is not in lib typings
    const ObjectAny = Object as any;
    if (!this.autoupdate || typeof ObjectAny.observe !== 'function') return;

    ObjectAny.unobserve(object, this.observerCallback);
  }

  /**
   * Adds a named collection transform to the collection
   * @param name - name to associate with transform
   * @param transform - an array of transformation 'step' objects to save into the collection
   * @example
   * users.addTransform('progeny', [
   *   {
   *     type: 'find',
   *     value: {
   *       'age': {'$lte': 40}
   *     }
   *   }
   * ]);
   *
   * var results = users.chain('progeny').data();
   */
  // biome-ignore lint/suspicious/noExplicitAny: transform steps are free-form
  addTransform(name: string, transform: any) {
    if (Object.hasOwn(this.transforms, name)) {
      throw new Error('a transform by that name already exists');
    }

    this.transforms[name] = transform;
  }

  /**
   * Retrieves a named transform from the collection.
   * @param name - name of the transform to lookup.
   */
  getTransform(name: string) {
    return this.transforms[name];
  }

  /**
   * Updates a named collection transform to the collection
   * @param name - name to associate with transform
   * @param transform - a transformation object to save into collection
   */
  // biome-ignore lint/suspicious/noExplicitAny: transform steps are free-form
  setTransform(name: string, transform: any) {
    this.transforms[name] = transform;
  }

  /**
   * Removes a named collection transform from the collection
   * @param name - name of collection transform to remove
   */
  removeTransform(name: string) {
    delete this.transforms[name];
  }

  // biome-ignore lint/suspicious/noExplicitAny: template is a free-form object
  byExample(template: any) {
    let k: string;
    // biome-ignore lint/suspicious/noExplicitAny: dynamic object
    let obj: any;
    // biome-ignore lint/suspicious/noExplicitAny: dynamic query objects
    const query: any[] = [];
    for (k in template) {
      if (!Object.hasOwn(template, k)) continue;
      obj = {};
      obj[k] = template[k];
      query.push(obj);
    }
    return {
      $and: query,
    };
  }

  // biome-ignore lint/suspicious/noExplicitAny: template is a free-form object
  findObject(template: any) {
    return this.findOne(this.byExample(template));
  }

  // biome-ignore lint/suspicious/noExplicitAny: template is a free-form object
  findObjects(template: any) {
    return this.find(this.byExample(template));
  }

  /*----------------------------+
  | TTL daemon                  |
  +----------------------------*/
  ttlDaemonFuncGen() {
    const collection = this;
    const age = this.ttl.age as number;
    return function ttlDaemon() {
      const now = Date.now();
      // biome-ignore lint/suspicious/noExplicitAny: dynamic document
      const toRemove = collection.chain().where(function daemonFilter(member: any) {
        const timestamp = member.meta.updated || member.meta.created;
        const diff = now - timestamp;
        return age < diff;
      });
      toRemove.remove();
    };
  }

  /**
   * Updates or applies collection TTL settings.
   * @param age - age (in ms) to expire document from collection
   * @param interval - time (in ms) to clear collection of aged documents.
   */
  setTTL(age: number, interval?: number) {
    if (age < 0) {
      clearInterval(this.ttl.daemon);
    } else {
      this.ttl.age = age;
      this.ttl.ttlInterval = interval;
      this.ttl.daemon = setInterval(this.ttlDaemonFuncGen(), interval);
    }
  }

  /*----------------------------+
  | INDEXING                    |
  +----------------------------*/

  /**
   * create a row filter that covers all documents in the collection
   */
  prepareFullDocIndex() {
    const len = this.data.length;
    const indexes = new Array<number>(len);
    for (let i = 0; i < len; i += 1) {
      indexes[i] = i;
    }
    return indexes;
  }

  /**
   * Will allow reconfiguring certain collection options.
   * @param options.adaptiveBinaryIndices - collection indices will be actively rebuilt rather than lazily
   */
  configureOptions(options?: { adaptiveBinaryIndices?: boolean }) {
    const opts = options || {};

    if (Object.hasOwn(opts, 'adaptiveBinaryIndices')) {
      this.adaptiveBinaryIndices = opts.adaptiveBinaryIndices as boolean;

      // if switching to adaptive binary indices, make sure none are 'dirty'
      if (this.adaptiveBinaryIndices) {
        this.ensureAllIndexes();
      }
    }
  }

  /**
   * Ensure binary index on a certain field
   * @param property - name of property to create binary index on
   * @param force - (Optional) flag indicating whether to construct index immediately
   */
  ensureIndex(property: string, force?: boolean) {
    // optional parameter to force rebuild whether flagged as dirty or not
    if (typeof force === 'undefined') {
      force = false;
    }

    if (property === null || property === undefined) {
      throw new Error('Attempting to set index without an associated property');
    }

    if (this.binaryIndices[property] && !force) {
      if (!this.binaryIndices[property].dirty) return;
    }

    // if the index is already defined and we are using adaptiveBinaryIndices and we are not forcing a rebuild, return.
    if (
      this.adaptiveBinaryIndices === true &&
      Object.hasOwn(this.binaryIndices, property) &&
      !force
    ) {
      return;
    }

    const index: CollectionBinaryIndex = {
      name: property,
      dirty: true,
      values: this.prepareFullDocIndex(),
    };
    this.binaryIndices[property] = index;

    const wrappedComparer = ((prop: string, data: LokiDocument<T>[]) => {
      // biome-ignore lint/suspicious/noExplicitAny: dynamic property values
      let val1: any;
      // biome-ignore lint/suspicious/noExplicitAny: dynamic property values
      let val2: any;
      const propPath = ~prop.indexOf('.') ? prop.split('.') : false;
      return (a: number, b: number) => {
        if (propPath) {
          val1 = Utils.getIn(data[a], propPath, true);
          val2 = Utils.getIn(data[b], propPath, true);
        } else {
          // biome-ignore lint/suspicious/noExplicitAny: dynamic property access
          val1 = (data[a] as any)[prop];
          // biome-ignore lint/suspicious/noExplicitAny: dynamic property access
          val2 = (data[b] as any)[prop];
        }

        if (val1 !== val2) {
          if (Comparators.lt(val1, val2, false)) return -1;
          if (Comparators.gt(val1, val2, false)) return 1;
        }
        return 0;
      };
    })(property, this.data);

    index.values.sort(wrappedComparer);
    index.dirty = false;

    this.dirty = true; // for autosave scenarios
  }

  /**
   * Perform checks to determine validity/consistency of all binary indices
   * @param options - optional configuration object
   * @param options.randomSampling - whether (faster) random sampling should be used
   * @param options.randomSamplingFactor - percentage of total rows to randomly sample
   * @param options.repair - whether to fix problems if they are encountered
   * @returns array of index names where problems were found.
   * @example
   * // check all indices on a collection, returns array of invalid index names
   * var result = coll.checkAllIndexes({ repair: true, randomSampling: true, randomSamplingFactor: 0.15 });
   * if (result.length > 0) {
   *   results.forEach(function(name) {
   *     console.log('problem encountered with index : ' + name);
   *   });
   * }
   */
  checkAllIndexes(options?: CheckIndexOptions) {
    let key: string;
    const bIndices = this.binaryIndices;
    const results: string[] = [];
    let result: boolean;

    for (key in bIndices) {
      if (hasOwn.call(bIndices, key)) {
        result = this.checkIndex(key, options);
        if (!result) {
          results.push(key);
        }
      }
    }

    return results;
  }

  /**
   * Perform checks to determine validity/consistency of a binary index
   * @param property - name of the binary-indexed property to check
   * @param options - optional configuration object
   * @param options.randomSampling - whether (faster) random sampling should be used
   * @param options.randomSamplingFactor - percentage of total rows to randomly sample
   * @param options.repair - whether to fix problems if they are encountered
   * @returns whether the index was found to be valid (before optional correcting).
   * @example
   * // full test
   * var valid = coll.checkIndex('name');
   * // full test with repair (if issues found)
   * valid = coll.checkIndex('name', { repair: true });
   * // random sampling (default is 10% of total document count)
   * valid = coll.checkIndex('name', { randomSampling: true });
   * // random sampling (sample 20% of total document count)
   * valid = coll.checkIndex('name', { randomSampling: true, randomSamplingFactor: 0.20 });
   * // random sampling (implied boolean)
   * valid = coll.checkIndex('name', { randomSamplingFactor: 0.20 });
   * // random sampling with repair (if issues found)
   * valid = coll.checkIndex('name', { repair: true, randomSampling: true });
   */
  checkIndex(property: string, options?: CheckIndexOptions) {
    const opts: CheckIndexOptions = options || {};
    // if 'randomSamplingFactor' specified but not 'randomSampling', assume true
    if (opts.randomSamplingFactor && opts.randomSampling !== false) {
      opts.randomSampling = true;
    }
    opts.randomSamplingFactor = opts.randomSamplingFactor || 0.1;
    if (opts.randomSamplingFactor < 0 || opts.randomSamplingFactor > 1) {
      opts.randomSamplingFactor = 0.1;
    }

    let valid = true;
    let idx: number;
    let iter: number;
    let pos: number;
    let len: number;
    let biv: number[];

    // make sure we are passed a valid binary index name
    if (!Object.hasOwn(this.binaryIndices, property)) {
      throw new Error(`called checkIndex on property without an index: ${property}`);
    }

    // if lazy indexing, rebuild only if flagged as dirty
    if (!this.adaptiveBinaryIndices) {
      this.ensureIndex(property);
    }

    biv = this.binaryIndices[property].values;
    len = biv.length;

    // if the index has an incorrect number of values
    if (len !== this.data.length) {
      if (opts.repair) {
        this.ensureIndex(property, true);
      }
      return false;
    }

    if (len === 0) {
      return true;
    }

    const usingDotNotation = property.indexOf('.') !== -1;

    if (len === 1) {
      valid = biv[0] === 0;
    } else {
      if (opts.randomSampling) {
        // validate first and last
        if (
          !LokiOps.$lte(
            Utils.getIn(this.data[biv[0]], property, usingDotNotation),
            Utils.getIn(this.data[biv[1]], property, usingDotNotation),
          )
        ) {
          valid = false;
        }
        if (
          !LokiOps.$lte(
            Utils.getIn(this.data[biv[len - 2]], property, usingDotNotation),
            Utils.getIn(this.data[biv[len - 1]], property, usingDotNotation),
          )
        ) {
          valid = false;
        }

        // if first and last positions are sorted correctly with their nearest neighbor,
        // continue onto random sampling phase...
        if (valid) {
          // # random samplings = total count * sampling factor
          iter = Math.floor((len - 1) * opts.randomSamplingFactor);

          // for each random sampling, validate that the binary index is sequenced properly
          // with next higher value.
          for (idx = 0; idx < iter - 1; idx++) {
            // calculate random position
            pos = Math.floor(Math.random() * (len - 1));
            if (
              !LokiOps.$lte(
                Utils.getIn(this.data[biv[pos]], property, usingDotNotation),
                Utils.getIn(this.data[biv[pos + 1]], property, usingDotNotation),
              )
            ) {
              valid = false;
              break;
            }
          }
        }
      } else {
        // validate that the binary index is sequenced properly
        for (idx = 0; idx < len - 1; idx++) {
          if (
            !LokiOps.$lte(
              Utils.getIn(this.data[biv[idx]], property, usingDotNotation),
              Utils.getIn(this.data[biv[idx + 1]], property, usingDotNotation),
            )
          ) {
            valid = false;
            break;
          }
        }
      }
    }

    // if incorrectly sequenced and we are to fix problems, rebuild index
    if (!valid && opts.repair) {
      this.ensureIndex(property, true);
    }

    return valid;
  }

  getBinaryIndexValues(property: string) {
    let idx: number;
    const idxvals = this.binaryIndices[property].values;
    // biome-ignore lint/suspicious/noExplicitAny: dynamic property values
    const result: any[] = [];

    for (idx = 0; idx < idxvals.length; idx++) {
      result.push(Utils.getIn(this.data[idxvals[idx]], property, true));
    }

    return result;
  }

  /**
   * Returns a named unique index
   * @param field - indexed field name
   * @param force - if `true`, will rebuild index; otherwise, function may return null
   */
  getUniqueIndex(field: string, force?: boolean): UniqueIndex {
    const index = this.constraints.unique[field];
    if (!index && force) {
      return this.ensureUniqueIndex(field);
    }
    return index;
  }

  ensureUniqueIndex(field: string) {
    let index = this.constraints.unique[field];
    if (!index) {
      // keep track of new unique index for regenerate after database (re)load.
      if (this.uniqueNames.indexOf(field) === -1) {
        this.uniqueNames.push(field);
      }
    }

    // if index already existed, (re)loading it will likely cause collisions, rebuild always
    this.constraints.unique[field] = index = new UniqueIndex(field);
    this.data.forEach((obj) => {
      index.set(obj);
    });
    return index;
  }

  /**
   * Ensure all binary indices
   * @param force - whether to force rebuild of existing lazy binary indices
   */
  ensureAllIndexes(force?: boolean) {
    let key: string;
    const bIndices = this.binaryIndices;
    for (key in bIndices) {
      if (hasOwn.call(bIndices, key)) {
        this.ensureIndex(key, force);
      }
    }
  }

  /**
   * Internal method used to flag all lazy index as dirty
   */
  flagBinaryIndexesDirty() {
    let key: string;
    const bIndices = this.binaryIndices;
    for (key in bIndices) {
      if (hasOwn.call(bIndices, key)) {
        bIndices[key].dirty = true;
      }
    }
  }

  /**
   * Internal method used to flag a lazy index as dirty
   */
  flagBinaryIndexDirty(index: string) {
    if (this.binaryIndices[index]) this.binaryIndices[index].dirty = true;
  }

  /**
   * Quickly determine number of documents in collection (or query)
   * @param query - (optional) query object to count results of
   * @returns number of documents in the collection
   */
  // biome-ignore lint/suspicious/noExplicitAny: query values are dynamic
  count(query?: LokiQuery<any>) {
    if (!query) {
      return this.data.length;
    }

    return this.chain().find(query).filteredrows.length;
  }

  /**
   * Rebuild idIndex
   */
  ensureId() {
    if (this.idIndex) {
      return;
    }
    const data = this.data;
    let i = 0;
    const len = data.length;
    const index = new Array<number>(len);
    for (i; i < len; i++) {
      index[i] = data[i].$loki;
    }
    this.idIndex = index;
  }

  /**
   * Rebuild idIndex async with callback - useful for background syncing with a remote server
   */
  ensureIdAsync(callback: () => void) {
    this.async(function (this: Collection<T>) {
      // original quirk: `this` is not bound when invoked by async()
      this.ensureId();
    }, callback);
  }

  /**
   * Add a dynamic view to the collection
   * @param name - name of dynamic view to add
   * @param options - options to configure dynamic view with
   * @param options.persistent - indicates if view is to main internal results array in 'resultdata'
   * @param options.sortPriority - 'passive' (sorts performed on call to data) or 'active' (after updates)
   * @param options.minRebuildInterval - minimum rebuild interval (need clarification to docs here)
   * @returns reference to the dynamic view added
   * @example
   * var pview = users.addDynamicView('progeny');
   * pview.applyFind({'age': {'$lte': 40}});
   * pview.applySimpleSort('name');
   *
   * var results = pview.data();
   **/
  // biome-ignore lint/suspicious/noExplicitAny: options are defined by DynamicView
  addDynamicView(name: string, options?: any): DynamicView<T> {
    const dv = new DynamicView<T>(this, name, options);
    this.DynamicViews.push(dv);

    return dv;
  }

  /**
   * Remove a dynamic view from the collection
   * @param name - name of dynamic view to remove
   **/
  removeDynamicView(name: string) {
    this.DynamicViews = this.DynamicViews.filter((dv) => dv.name !== name);
  }

  /**
   * Look up dynamic view reference from within the collection
   * @param name - name of dynamic view to retrieve reference of
   * @returns A reference to the dynamic view with that name
   **/
  getDynamicView(name: string): DynamicView<T> | null {
    for (let idx = 0; idx < this.DynamicViews.length; idx++) {
      if (this.DynamicViews[idx].name === name) {
        return this.DynamicViews[idx];
      }
    }

    return null;
  }

  /**
   * Applies a 'mongo-like' find query object and passes all results to an update function.
   * For filter function querying you should migrate to [updateWhere()]{@link Collection#updateWhere}.
   *
   * @param filterObject - 'mongo-like' query object (or deprecated filterFunction mode)
   * @param updateFunction - update function to run against filtered documents
   */
  findAndUpdate(
    // biome-ignore lint/suspicious/noExplicitAny: query object or filter function
    filterObject: any,
    // biome-ignore lint/suspicious/noExplicitAny: update callback over dynamic documents
    updateFunction: (obj: any) => any,
  ) {
    if (typeof filterObject === 'function') {
      this.updateWhere(filterObject, updateFunction);
    } else {
      this.chain().find(filterObject).update(updateFunction);
    }
  }

  /**
   * Applies a 'mongo-like' find query object removes all documents which match that filter.
   *
   * @param filterObject - 'mongo-like' query object
   */
  // biome-ignore lint/suspicious/noExplicitAny: query values are dynamic
  findAndRemove(filterObject: LokiQuery<any>) {
    this.chain().find(filterObject).remove();
  }

  /**
   * Adds object(s) to collection, ensure object(s) have meta properties, clone it if necessary, etc.
   * @param doc - the document (or array of documents) to be inserted
   * @param overrideAdaptiveIndices - (optional) if `true`, adaptive indicies will be
   *   temporarily disabled and then fully rebuilt after batch. This will be faster for
   *   large inserts, but slower for small/medium inserts in large collections
   * @returns document or documents inserted
   * @example
   * users.insert({
   *     name: 'Odin',
   *     age: 50,
   *     address: 'Asgard'
   * });
   *
   * // alternatively, insert array of documents
   * users.insert([{ name: 'Thor', age: 35}, { name: 'Loki', age: 30}]);
   */
  // biome-ignore lint/suspicious/noExplicitAny: returns a document, an array of documents or undefined
  insert(doc: T | T[], overrideAdaptiveIndices?: boolean): any {
    if (!Array.isArray(doc)) {
      return this.insertOne(doc);
    }

    // holder to the clone of the object inserted if collections is set to clone objects
    let obj: LokiDocument<T> | undefined;
    let results: LokiDocument<T>[] = [];

    // if not cloning, disable adaptive binary indices for the duration of the batch insert,
    // followed by lazy rebuild and re-enabling adaptive indices after batch insert.
    const adaptiveBatchOverride =
      overrideAdaptiveIndices &&
      !this.cloneObjects &&
      this.adaptiveBinaryIndices &&
      Object.keys(this.binaryIndices).length > 0;

    if (adaptiveBatchOverride) {
      this.adaptiveBinaryIndices = false;
    }

    try {
      this.emit('pre-insert', doc);
      for (let i = 0, len = doc.length; i < len; i++) {
        obj = this.insertOne(doc[i], true);
        if (!obj) {
          return undefined;
        }
        results.push(obj);
      }
    } finally {
      if (adaptiveBatchOverride) {
        this.ensureAllIndexes();
        this.adaptiveBinaryIndices = true;
      }
    }

    // at the 'batch' level, if clone option is true then emitted docs are clones
    this.emit('insert', results);

    // if clone option is set, clone return values
    results = this.cloneObjects ? clone(results, this.cloneMethod) : results;

    return results.length === 1 ? results[0] : results;
  }

  /**
   * Adds a single object, ensures it has meta properties, clone it if necessary, etc.
   * @param doc - the document to be inserted
   * @param bulkInsert - quiet pre-insert and insert event emits
   * @returns document or 'undefined' if there was a problem inserting it
   */
  insertOne(doc: T, bulkInsert?: boolean): LokiDocument<T> | undefined {
    let err: TypeError | null = null;
    let returnObj: LokiDocument<T>;

    if (typeof doc !== 'object') {
      err = new TypeError('Document needs to be an object');
    } else if (doc === null) {
      err = new TypeError('Object cannot be null');
    }

    if (err !== null) {
      this.emit('error', err);
      throw err;
    }

    // if configured to clone, do so now... otherwise just use same obj reference
    // biome-ignore lint/suspicious/noExplicitAny: the document gains $loki and meta while inserted
    let obj: any = this.cloneObjects ? clone(doc, this.cloneMethod) : doc;
    if (!this.disableFreeze) {
      obj = unFreeze(obj);
    }

    if (!this.disableMeta) {
      if (typeof obj.meta === 'undefined') {
        obj.meta = {
          revision: 0,
          created: 0,
        };
      } else if (!this.disableFreeze) {
        obj.meta = unFreeze(obj.meta);
      }
    }

    // both 'pre-insert' and 'insert' events are passed internal data reference even when cloning
    // insert needs internal reference because that is where loki itself listens to add meta
    if (!bulkInsert) {
      this.emit('pre-insert', obj);
    }
    if (!this.add(obj)) {
      return undefined;
    }

    // update meta and store changes if ChangesAPI is enabled
    // (moved from "insert" event listener to allow internal reference to be used)
    if (this.disableChangesApi) {
      this.insertMeta(obj);
    } else {
      this.insertMetaWithChange(obj);
    }

    if (!this.disableFreeze) {
      deepFreeze(obj);
    }

    // if cloning is enabled, emit insert event with clone of new object
    returnObj = this.cloneObjects ? clone(obj, this.cloneMethod) : obj;

    if (!bulkInsert) {
      this.emit('insert', returnObj);
    }

    this.addAutoUpdateObserver(returnObj);

    return returnObj;
  }

  /**
   * Empties the collection.
   * @param options - configure clear behavior
   * @param options.removeIndices - whether to remove indices in addition to data
   */
  clear(options?: { removeIndices?: boolean }) {
    const opts = options || {};

    this.data = [];
    this.idIndex = null;
    this.cachedIndex = null;
    this.cachedBinaryIndex = null;
    this.cachedData = null;
    this.maxId = 0;
    this.DynamicViews = [];
    this.dirty = true;
    this.constraints = {
      unique: {},
      exact: {},
    };

    // if removing indices entirely
    if (opts.removeIndices === true) {
      this.binaryIndices = {};
      this.uniqueNames = [];
    }
    // clear indices but leave definitions in place
    else {
      // clear binary indices
      const keys = Object.keys(this.binaryIndices);
      keys.forEach((biname) => {
        this.binaryIndices[biname].dirty = false;
        this.binaryIndices[biname].values = [];
      });
    }
  }

  /**
   * Updates an object and notifies collection that the document has changed.
   * @param doc - document to update within the collection
   */
  // biome-ignore lint/suspicious/noExplicitAny: returns the updated document (or nothing for batches)
  update(doc: any): any {
    let adaptiveBatchOverride: boolean | undefined;
    let k: number;
    let len: number;

    if (Array.isArray(doc)) {
      len = doc.length;

      // if not cloning, disable adaptive binary indices for the duration of the batch update,
      // followed by lazy rebuild and re-enabling adaptive indices after batch update.
      adaptiveBatchOverride =
        !this.cloneObjects &&
        this.adaptiveBinaryIndices &&
        Object.keys(this.binaryIndices).length > 0;

      if (adaptiveBatchOverride) {
        this.adaptiveBinaryIndices = false;
      }

      try {
        for (k = 0; k < len; k += 1) {
          this.update(doc[k]);
        }
      } finally {
        if (adaptiveBatchOverride) {
          this.ensureAllIndexes();
          this.adaptiveBinaryIndices = true;
        }
      }

      return;
    }

    // verify object is a properly formed document
    if (!hasOwn.call(doc, '$loki')) {
      throw new Error(
        'Trying to update unsynced document. Please save the document first by using insert() or addMany()',
      );
    }
    try {
      this.startTransaction();
      const arr = this.get(doc.$loki, true) as [LokiDocument<T>, number] | null;
      let oldInternal: LokiDocument<T>; // ref to existing obj
      // biome-ignore lint/suspicious/noExplicitAny: ref to new internal obj
      let newInternal: any; // ref to new internal obj
      let position: number;

      if (!arr) {
        throw new Error('Trying to update a document not in collection.');
      }

      oldInternal = arr[0]; // -internal- obj ref
      position = arr[1]; // position in data array

      // if configured to clone, do so now... otherwise just use same obj reference
      newInternal =
        this.cloneObjects || (!this.disableDeltaChangesApi && this.disableFreeze)
          ? clone(doc, this.cloneMethod)
          : doc;

      this.emit('pre-update', doc);

      this.uniqueNames.forEach((key) => {
        this.getUniqueIndex(key, true).update(oldInternal, newInternal);
      });

      // operate the update
      this.data[position] = newInternal;

      if (newInternal !== doc) {
        this.addAutoUpdateObserver(doc);
      }

      // now that we can efficiently determine the data[] position of newly added document,
      // submit it for all registered DynamicViews to evaluate for inclusion/exclusion
      for (let idx = 0; idx < this.DynamicViews.length; idx++) {
        this.DynamicViews[idx].evaluateDocument(position, false);
      }

      let key: string;
      if (this.adaptiveBinaryIndices) {
        // for each binary index defined in collection, immediately update rather than flag for lazy rebuild
        const bIndices = this.binaryIndices;
        for (key in bIndices) {
          this.adaptiveBinaryIndexUpdate(position, key);
        }
      } else {
        this.flagBinaryIndexesDirty();
      }

      (this.idIndex as number[])[position] = newInternal.$loki;
      //this.flagBinaryIndexesDirty();

      if (this.isIncremental) {
        this.dirtyIds.push(newInternal.$loki);
      }

      this.commit();
      this.dirty = true; // for autosave scenarios

      // update meta and store changes if ChangesAPI is enabled
      if (this.disableChangesApi) {
        newInternal = this.updateMeta(newInternal);
      } else {
        newInternal = this.updateMetaWithChange(newInternal, oldInternal);
      }

      if (!this.disableFreeze) {
        deepFreeze(newInternal);
      }

      // biome-ignore lint/suspicious/noExplicitAny: returned document
      let returnObj: any;

      // if cloning is enabled, emit 'update' event and return with clone of new object
      if (this.cloneObjects) {
        returnObj = clone(newInternal, this.cloneMethod);
      } else {
        returnObj = newInternal;
      }

      this.emit('update', returnObj, oldInternal);
      return returnObj;
    } catch (err) {
      this.rollback();
      this.lokiConsoleWrapper.error((err as Error).message);
      this.emit('error', err);
      throw err; // re-throw error so user does not think it succeeded
    }
  }

  /**
   * Add object to collection
   */
  // biome-ignore lint/suspicious/noExplicitAny: the document gains $loki and meta while added
  add(obj: any): any {
    // if parameter isn't object exit with throw
    if ('object' !== typeof obj) {
      throw new TypeError('Object being added needs to be an object');
    }
    // if object you are adding already has id column it is either already in the collection
    // or the object is carrying its own 'id' property.  If it also has a meta property,
    // then this is already in collection so throw error, otherwise rename to originalId and continue adding.
    if (typeof obj.$loki !== 'undefined') {
      throw new Error('Document is already in collection, please use update()');
    }

    /*
     * try adding object to collection
     */
    try {
      this.startTransaction();
      this.maxId++;

      if (Number.isNaN(this.maxId)) {
        this.maxId = this.data[this.data.length - 1].$loki + 1;
      }

      const newId = this.maxId;
      obj.$loki = newId;

      if (!this.disableMeta) {
        obj.meta.version = 0;
      }

      let i: number;
      for (i = 0; i < this.uniqueNames.length; i++) {
        this.getUniqueIndex(this.uniqueNames[i], true).set(obj);
      }

      if (this.idIndex) {
        this.idIndex.push(newId);
      }

      if (this.isIncremental) {
        this.dirtyIds.push(newId);
      }

      // add the object
      this.data.push(obj);

      const addedPos = this.data.length - 1;

      // now that we can efficiently determine the data[] position of newly added document,
      // submit it for all registered DynamicViews to evaluate for inclusion/exclusion
      const dvlen = this.DynamicViews.length;
      for (i = 0; i < dvlen; i++) {
        this.DynamicViews[i].evaluateDocument(addedPos, true);
      }

      if (this.adaptiveBinaryIndices) {
        // for each binary index defined in collection, immediately update rather than flag for lazy rebuild
        const bIndices = this.binaryIndices;
        for (const key in bIndices) {
          this.adaptiveBinaryIndexInsert(addedPos, key);
        }
      } else {
        this.flagBinaryIndexesDirty();
      }

      this.commit();
      this.dirty = true; // for autosave scenarios

      return this.cloneObjects ? clone(obj, this.cloneMethod) : obj;
    } catch (err) {
      this.rollback();
      this.lokiConsoleWrapper.error((err as Error).message);
      this.emit('error', err);
      throw err; // re-throw error so user does not think it succeeded
    }
  }

  /**
   * Applies a filter function and passes all results to an update function.
   *
   * @param filterFunction - filter function whose results will execute update
   * @param updateFunction - update function to run against filtered documents
   */
  updateWhere(
    // biome-ignore lint/suspicious/noExplicitAny: user filter over dynamic documents
    filterFunction: (obj: any) => boolean,
    // biome-ignore lint/suspicious/noExplicitAny: user update over dynamic documents
    updateFunction: (obj: any) => any,
  ) {
    const results = this.where(filterFunction);
    let i = 0;
    // biome-ignore lint/suspicious/noExplicitAny: updated document
    let obj: any;
    try {
      for (i; i < results.length; i++) {
        obj = updateFunction(results[i]);
        this.update(obj);
      }
    } catch (err) {
      this.rollback();
      this.lokiConsoleWrapper.error((err as Error).message);
    }
  }

  /**
   * Remove all documents matching supplied filter function.
   * For 'mongo-like' querying you should migrate to [findAndRemove()]{@link Collection#findAndRemove}.
   * @param query - query object to filter on
   */
  // biome-ignore lint/suspicious/noExplicitAny: filter function or query object
  removeWhere(query: any) {
    let list: LokiDocument<T>[];
    if (typeof query === 'function') {
      list = this.data.filter(query);
      this.remove(list);
    } else {
      this.chain().find(query).remove();
    }
  }

  removeDataOnly() {
    this.remove(this.data.slice());
  }

  /**
   * Internal method to remove a batch of documents from the collection.
   * @param positions - data/idIndex positions to remove
   */
  removeBatchByPositions(positions: number[]): null | undefined {
    const len = positions.length;
    const xo: Record<string, boolean> = {};
    let dlen: number;
    let didx: number;
    let idx: number;
    const bic = Object.keys(this.binaryIndices).length;
    const uic = Object.keys(this.constraints.unique).length;
    const adaptiveOverride =
      this.adaptiveBinaryIndices && Object.keys(this.binaryIndices).length > 0;
    // biome-ignore lint/suspicious/noExplicitAny: dynamic document
    let doc: any;

    try {
      this.startTransaction();

      // create hashobject for positional removal inclusion tests...
      // all keys defined in this hashobject represent $loki ids of the documents to remove.
      this.ensureId();
      for (idx = 0; idx < len; idx++) {
        xo[(this.idIndex as number[])[positions[idx]]] = true;
      }

      // if we will need to notify dynamic views and/or binary indices to update themselves...
      dlen = this.DynamicViews.length;
      if (dlen > 0 || bic > 0 || uic > 0) {
        if (dlen > 0) {
          // notify dynamic views to remove relevant documents at data positions
          for (didx = 0; didx < dlen; didx++) {
            // notify dv of remove (passing batch/array of positions)
            this.DynamicViews[didx].removeDocument(positions);
          }
        }

        // notify binary indices to update
        if (this.adaptiveBinaryIndices && !adaptiveOverride) {
          // for each binary index defined in collection, immediately update rather than flag for lazy rebuild
          let key: string;
          const bIndices = this.binaryIndices;

          for (key in bIndices) {
            this.adaptiveBinaryIndexRemove(positions, key);
          }
        } else {
          this.flagBinaryIndexesDirty();
        }

        if (uic) {
          this.uniqueNames.forEach((key) => {
            const index = this.getUniqueIndex(key);
            if (index) {
              for (idx = 0; idx < len; idx++) {
                doc = this.data[positions[idx]];
                if (doc[key] !== null && doc[key] !== undefined) {
                  index.remove(doc[key]);
                }
              }
            }
          });
        }
      }

      // emit 'delete' events only of listeners are attached.
      // since data not removed yet, in future we can emit single delete event with array...
      // for now that might be breaking change to put in potential 1.6 or LokiDB (lokijs2) version
      if (!this.disableChangesApi || this.events.delete.length > 1) {
        for (idx = 0; idx < len; idx++) {
          this.emit('delete', this.data[positions[idx]]);
        }
      }

      // remove from data[] :
      // filter collection data for items not in inclusion hashobject
      this.data = this.data.filter((obj) => {
        return !xo[obj.$loki];
      });

      if (this.isIncremental) {
        for (idx = 0; idx < len; idx++) {
          this.dirtyIds.push((this.idIndex as number[])[positions[idx]]);
        }
      }

      // remove from idIndex[] :
      // filter idIndex for items not in inclusion hashobject
      this.idIndex = (this.idIndex as number[]).filter((id) => {
        return !xo[id];
      });

      if (this.adaptiveBinaryIndices && adaptiveOverride) {
        this.adaptiveBinaryIndices = false;
        this.ensureAllIndexes(true);
        this.adaptiveBinaryIndices = true;
      }

      this.commit();

      // flag collection as dirty for autosave
      this.dirty = true;
    } catch (err) {
      this.rollback();
      if (adaptiveOverride) {
        this.adaptiveBinaryIndices = true;
      }
      this.lokiConsoleWrapper.error((err as Error).message);
      this.emit('error', err);
      return null;
    }
    return undefined;
  }

  /**
   *  Internal method called by remove()
   * @param batch - array of documents or $loki ids to remove
   */
  // biome-ignore lint/suspicious/noExplicitAny: documents or $loki ids
  removeBatch(batch: any[]) {
    const len = batch.length;
    const dlen = this.data.length;
    let idx: number;
    const xlt: Record<string, number> = {};
    const posx: number[] = [];

    // create lookup hashobject to translate $loki id to position
    for (idx = 0; idx < dlen; idx++) {
      xlt[this.data[idx].$loki] = idx;
    }

    // iterate the batch
    for (idx = 0; idx < len; idx++) {
      if (typeof batch[idx] === 'object') {
        posx.push(xlt[batch[idx].$loki]);
      } else {
        posx.push(xlt[batch[idx]]);
      }
    }

    this.removeBatchByPositions(posx);
  }

  /**
   * Remove a document from the collection
   * @param doc - document to remove from collection
   */
  // biome-ignore lint/suspicious/noExplicitAny: document, array of documents or $loki id
  remove(doc: any): any {
    if (typeof doc === 'number') {
      doc = this.get(doc);
    }

    if ('object' !== typeof doc) {
      throw new Error('Parameter is not an object');
    }
    if (Array.isArray(doc)) {
      this.removeBatch(doc);
      return;
    }

    if (!hasOwn.call(doc, '$loki')) {
      throw new Error('Object is not a document stored in the collection');
    }

    try {
      this.startTransaction();
      const arr = this.get(doc.$loki, true) as [LokiDocument<T>, number];
      // obj = arr[0],
      const position = arr[1];
      this.uniqueNames.forEach((key) => {
        if (doc[key] !== null && typeof doc[key] !== 'undefined') {
          const index = this.getUniqueIndex(key);
          if (index) {
            index.remove(doc[key]);
          }
        }
      });
      // now that we can efficiently determine the data[] position of newly added document,
      // submit it for all registered DynamicViews to remove
      for (let idx = 0; idx < this.DynamicViews.length; idx++) {
        this.DynamicViews[idx].removeDocument(position);
      }

      if (this.adaptiveBinaryIndices) {
        // for each binary index defined in collection, immediately update rather than flag for lazy rebuild
        let key: string;
        const bIndices = this.binaryIndices;
        for (key in bIndices) {
          this.adaptiveBinaryIndexRemove(position, key);
        }
      } else {
        this.flagBinaryIndexesDirty();
      }

      this.data.splice(position, 1);
      this.removeAutoUpdateObserver(doc);

      // remove id from idIndex
      (this.idIndex as number[]).splice(position, 1);

      if (this.isIncremental) {
        this.dirtyIds.push(doc.$loki);
      }

      this.commit();
      this.dirty = true; // for autosave scenarios
      this.emit('delete', arr[0]);

      if (!this.disableFreeze) {
        doc = unFreeze(doc);
      }
      delete doc.$loki;
      delete doc.meta;
      if (!this.disableFreeze) {
        freeze(doc);
      }
      return doc;
    } catch (err) {
      this.rollback();
      this.lokiConsoleWrapper.error((err as Error).message);
      this.emit('error', err);
      return null;
    }
  }

  /*---------------------+
  | Finding methods     |
  +----------------------*/

  /**
   * Get by Id - faster than other methods because of the searching algorithm
   * @param id - $loki id of document you want to retrieve
   * @param returnPosition - if 'true' we will return [object, position]
   * @returns Object reference if document was found, null if not,
   *     or an array if 'returnPosition' was passed.
   */
  // biome-ignore lint/suspicious/noExplicitAny: object, [object, position] or null depending on returnPosition
  get(id: number | string, returnPosition?: boolean): any {
    if (!this.idIndex) {
      this.ensureId();
    }

    const retpos = returnPosition || false;
    const data = this.idIndex as number[];
    let max = data.length - 1;
    let min = 0;
    let mid = (min + max) >> 1;

    id = typeof id === 'number' ? id : Number.parseInt(id, 10);

    if (Number.isNaN(id)) {
      throw new TypeError('Passed id is not an integer');
    }

    while (data[min] < data[max]) {
      mid = (min + max) >> 1;

      if (data[mid] < id) {
        min = mid + 1;
      } else {
        max = mid;
      }
    }

    if (max === min && data[min] === id) {
      if (retpos) {
        return [this.data[min], min];
      }
      return this.data[min];
    }
    return null;
  }

  /**
   * Perform binary range lookup for the data[dataPosition][binaryIndexName] property value
   *    Since multiple documents may contain the same value (which the index is sorted on),
   *    we hone in on range and then linear scan range to find exact index array position.
   * @param dataPosition - coll.data array index/position
   * @param binaryIndexName - index to search for dataPosition in
   */
  getBinaryIndexPosition(dataPosition: number, binaryIndexName: string) {
    const val = Utils.getIn(this.data[dataPosition], binaryIndexName, true);
    const index = this.binaryIndices[binaryIndexName].values;

    // i think calculateRange can probably be moved to collection
    // as it doesn't seem to need resultset.  need to verify
    const range = this.calculateRange('$eq', binaryIndexName, val);

    if (range[0] === 0 && range[1] === -1) {
      // uhoh didn't find range
      return null;
    }

    const min = range[0];
    const max = range[1];

    // narrow down the sub-segment of index values
    // where the indexed property value exactly matches our
    // value and then linear scan to find exact -index- position
    for (let idx = min; idx <= max; idx++) {
      if (index[idx] === dataPosition) return idx;
    }

    // uhoh
    return null;
  }

  /**
   * Adaptively insert a selected item to the index.
   * @param dataPosition - coll.data array index/position
   * @param binaryIndexName - index to search for dataPosition in
   */
  adaptiveBinaryIndexInsert(dataPosition: number, binaryIndexName: string) {
    const usingDotNotation = binaryIndexName.indexOf('.') !== -1;
    const index = this.binaryIndices[binaryIndexName].values;
    let val = Utils.getIn(this.data[dataPosition], binaryIndexName, usingDotNotation);

    // If you are inserting a javascript Date value into a binary index, convert to epoch time
    if (this.serializableIndices === true && val instanceof Date) {
      // biome-ignore lint/suspicious/noExplicitAny: dynamic property assignment
      (this.data[dataPosition] as any)[binaryIndexName] = val.getTime();
      val = Utils.getIn(this.data[dataPosition], binaryIndexName);
    }

    const idxPos =
      index.length === 0
        ? 0
        : this.calculateRangeStart(binaryIndexName, val, true, usingDotNotation);

    // insert new data index into our binary index at the proper sorted location for relevant property calculated by idxPos.
    // doing this after adjusting dataPositions so no clash with previous item at that position.
    this.binaryIndices[binaryIndexName].values.splice(idxPos, 0, dataPosition);
  }

  /**
   * Adaptively update a selected item within an index.
   * @param dataPosition - coll.data array index/position
   * @param binaryIndexName - index to search for dataPosition in
   */
  adaptiveBinaryIndexUpdate(dataPosition: number, binaryIndexName: string) {
    // linear scan needed to find old position within index unless we optimize for clone scenarios later
    // within (my) node 5.6.0, the following for() loop with strict compare is -much- faster than indexOf()
    let idxPos: number;
    const index = this.binaryIndices[binaryIndexName].values;
    const len = index.length;

    for (idxPos = 0; idxPos < len; idxPos++) {
      if (index[idxPos] === dataPosition) break;
    }

    //var idxPos = this.binaryIndices[binaryIndexName].values.indexOf(dataPosition);
    this.binaryIndices[binaryIndexName].values.splice(idxPos, 1);

    //this.adaptiveBinaryIndexRemove(dataPosition, binaryIndexName, true);
    this.adaptiveBinaryIndexInsert(dataPosition, binaryIndexName);
  }

  /**
   * Adaptively remove a selected item from the index.
   * @param dataPosition - coll.data array index/position
   * @param binaryIndexName - index to search for dataPosition in
   */
  adaptiveBinaryIndexRemove(
    dataPosition: number | number[],
    binaryIndexName: string,
    removedFromIndexOnly?: boolean,
  ) {
    const bi = this.binaryIndices[binaryIndexName];
    let len: number;
    let idx: number;
    let rmidx: number;
    let rmlen: number;
    const rxo: Record<string, boolean> = {};
    let curr: number;
    let shift: number;
    let idxPos: number | null;

    if (Array.isArray(dataPosition)) {
      // when called from chained remove, and only one document in array,
      // it will be faster to use old algorithm
      rmlen = dataPosition.length;
      if (rmlen === 1) {
        dataPosition = dataPosition[0];
      }
      // we were passed an array (batch) of documents so use this 'batch optimized' algorithm
      else {
        for (rmidx = 0; rmidx < rmlen; rmidx++) {
          rxo[dataPosition[rmidx]] = true;
        }

        // remove document from index (with filter function)
        bi.values = bi.values.filter((di) => {
          return !rxo[di];
        });

        // if we passed this optional flag parameter, we are calling from adaptiveBinaryIndexUpdate,
        // in which case data positions stay the same.
        if (removedFromIndexOnly === true) {
          return;
        }

        const sortedPositions = dataPosition.slice();
        sortedPositions.sort((a, b) => {
          return a - b;
        });

        // to remove holes, we need to 'shift down' the index's data array positions
        // we need to adjust array positions -1 for each index data positions greater than removed positions
        len = bi.values.length;
        for (idx = 0; idx < len; idx++) {
          curr = bi.values[idx];
          shift = 0;
          for (rmidx = 0; rmidx < rmlen && curr > sortedPositions[rmidx]; rmidx++) {
            shift++;
          }
          bi.values[idx] -= shift;
        }

        // batch processed, bail out
        return;
      }

      // not a batch so continue...
    }

    idxPos = this.getBinaryIndexPosition(dataPosition as number, binaryIndexName);

    if (idxPos === null) {
      // throw new Error('unable to determine binary index position');
      return null;
    }

    // remove document from index (with splice)
    bi.values.splice(idxPos, 1);

    // if we passed this optional flag parameter, we are calling from adaptiveBinaryIndexUpdate,
    // in which case data positions stay the same.
    if (removedFromIndexOnly === true) {
      return;
    }

    // since index stores data array positions, if we remove a document
    // we need to adjust array positions -1 for all document positions greater than removed position
    len = bi.values.length;
    for (idx = 0; idx < len; idx++) {
      if (bi.values[idx] > (dataPosition as number)) {
        bi.values[idx]--;
      }
    }
  }

  /**
   * Internal method used for index maintenance and indexed searching.
   * Calculates the beginning of an index range for a given value.
   * For index maintainance (adaptive:true), we will return a valid index position to insert to.
   * For querying (adaptive:false/undefined), we will :
   *    return lower bound/index of range of that value (if found)
   *    return next lower index position if not found (hole)
   * If index is empty it is assumed to be handled at higher level, so
   * this method assumes there is at least 1 document in index.
   *
   * @param prop - name of property which has binary index
   * @param val - value to find within index
   * @param adaptive - if true, we will return insert position
   */
  // biome-ignore lint/suspicious/noExplicitAny: indexed values are dynamic
  calculateRangeStart(prop: string, val: any, adaptive?: boolean, usingDotNotation?: boolean) {
    const rcd = this.data;
    const index = this.binaryIndices[prop].values;
    let min = 0;
    let max = index.length - 1;
    let mid = 0;

    if (index.length === 0) {
      return -1;
    }

    // hone in on start position of value
    while (min < max) {
      mid = (min + max) >> 1;

      if (Comparators.lt(Utils.getIn(rcd[index[mid]], prop, usingDotNotation), val, false)) {
        min = mid + 1;
      } else {
        max = mid;
      }
    }

    const lbound = min;

    // found it... return it
    if (Comparators.aeq(val, Utils.getIn(rcd[index[lbound]], prop, usingDotNotation))) {
      return lbound;
    }

    // if not in index and our value is less than the found one
    if (Comparators.lt(val, Utils.getIn(rcd[index[lbound]], prop, usingDotNotation), false)) {
      return adaptive ? lbound : lbound - 1;
    }

    // not in index and our value is greater than the found one
    return adaptive ? lbound + 1 : lbound;
  }

  /**
   * Internal method used for indexed $between.  Given a prop (index name), and a value
   * (which may or may not yet exist) this will find the final position of that upper range value.
   */
  // biome-ignore lint/suspicious/noExplicitAny: indexed values are dynamic
  calculateRangeEnd(prop: string, val: any, usingDotNotation?: boolean) {
    const rcd = this.data;
    const index = this.binaryIndices[prop].values;
    let min = 0;
    let max = index.length - 1;
    let mid = 0;

    if (index.length === 0) {
      return -1;
    }

    // hone in on start position of value
    while (min < max) {
      mid = (min + max) >> 1;

      if (Comparators.lt(val, Utils.getIn(rcd[index[mid]], prop, usingDotNotation), false)) {
        max = mid;
      } else {
        min = mid + 1;
      }
    }

    const ubound = max;

    // only eq if last element in array is our val
    if (Comparators.aeq(val, Utils.getIn(rcd[index[ubound]], prop, usingDotNotation))) {
      return ubound;
    }

    // if not in index and our value is less than the found one
    if (Comparators.gt(val, Utils.getIn(rcd[index[ubound]], prop, usingDotNotation), false)) {
      return ubound + 1;
    }

    // either hole or first nonmatch
    if (Comparators.aeq(val, Utils.getIn(rcd[index[ubound - 1]], prop, usingDotNotation))) {
      return ubound - 1;
    }

    // hole, so ubound if nearest gt than the val we were looking for
    return ubound;
  }

  /**
   * calculateRange() - Binary Search utility method to find range/segment of values matching criteria.
   *    this is used for collection.find() and first find filter of resultset/dynview
   *    slightly different than get() binary search in that get() hones in on 1 value,
   *    but we have to hone in on many (range)
   * @param op - operation, such as $eq
   * @param prop - name of property to calculate range for
   * @param val - value to use for range calculation.
   * @returns [start, end] index array positions
   */
  // biome-ignore lint/suspicious/noExplicitAny: range values are dynamic
  calculateRange(op: string, prop: string, val: any): number[] {
    const rcd = this.data;
    const index = this.binaryIndices[prop].values;
    const min = 0;
    const max = index.length - 1;
    let lbound: number;
    // biome-ignore lint/suspicious/noExplicitAny: dynamic property values
    let lval: any;
    let ubound: number;
    // biome-ignore lint/suspicious/noExplicitAny: dynamic property values
    let uval: any;

    // when no documents are in collection, return empty range condition
    if (rcd.length === 0) {
      return [0, -1];
    }

    const usingDotNotation = prop.indexOf('.') !== -1;

    const minVal = Utils.getIn(rcd[index[min]], prop, usingDotNotation);
    const maxVal = Utils.getIn(rcd[index[max]], prop, usingDotNotation);

    // if value falls outside of our range return [0, -1] to designate no results
    switch (op) {
      case '$eq':
      case '$aeq':
        if (Comparators.lt(val, minVal, false) || Comparators.gt(val, maxVal, false)) {
          return [0, -1];
        }
        break;
      case '$dteq':
        if (Comparators.lt(val, minVal, false) || Comparators.gt(val, maxVal, false)) {
          return [0, -1];
        }
        break;
      case '$gt':
        // none are within range
        if (Comparators.gt(val, maxVal, true)) {
          return [0, -1];
        }
        // all are within range
        if (Comparators.gt(minVal, val, false)) {
          return [min, max];
        }
        break;
      case '$gte':
        // none are within range
        if (Comparators.gt(val, maxVal, false)) {
          return [0, -1];
        }
        // all are within range
        if (Comparators.gt(minVal, val, true)) {
          return [min, max];
        }
        break;
      case '$lt':
        // none are within range
        if (Comparators.lt(val, minVal, true)) {
          return [0, -1];
        }
        // all are within range
        if (Comparators.lt(maxVal, val, false)) {
          return [min, max];
        }
        break;
      case '$lte':
        // none are within range
        if (Comparators.lt(val, minVal, false)) {
          return [0, -1];
        }
        // all are within range
        if (Comparators.lt(maxVal, val, true)) {
          return [min, max];
        }
        break;
      case '$between':
        // none are within range (low range is greater)
        if (Comparators.gt(val[0], maxVal, false)) {
          return [0, -1];
        }
        // none are within range (high range lower)
        if (Comparators.lt(val[1], minVal, false)) {
          return [0, -1];
        }

        lbound = this.calculateRangeStart(prop, val[0], false, usingDotNotation);
        ubound = this.calculateRangeEnd(prop, val[1], usingDotNotation);

        if (lbound < 0) lbound++;
        if (ubound > max) ubound--;

        if (!Comparators.gt(Utils.getIn(rcd[index[lbound]], prop, usingDotNotation), val[0], true))
          lbound++;
        if (!Comparators.lt(Utils.getIn(rcd[index[ubound]], prop, usingDotNotation), val[1], true))
          ubound--;

        if (ubound < lbound) return [0, -1];

        return [lbound, ubound];
      case '$in': {
        const idxset: (boolean | undefined)[] = [];
        const segResult: number[] = [];
        // query each value '$eq' operator and merge the seqment results.
        for (let j = 0, len = val.length; j < len; j++) {
          const seg = this.calculateRange('$eq', prop, val[j]);

          for (let i = seg[0]; i <= seg[1]; i++) {
            if (idxset[i] === undefined) {
              idxset[i] = true;
              segResult.push(i);
            }
          }
        }
        return segResult;
      }
    }

    // determine lbound where needed
    switch (op) {
      case '$eq':
      case '$aeq':
      case '$dteq':
      case '$gte':
      case '$lt':
        lbound = this.calculateRangeStart(prop, val, false, usingDotNotation);
        lval = Utils.getIn(rcd[index[lbound]], prop, usingDotNotation);
        break;
      default:
        break;
    }

    // determine ubound where needed
    switch (op) {
      case '$eq':
      case '$aeq':
      case '$dteq':
      case '$lte':
      case '$gt':
        ubound = this.calculateRangeEnd(prop, val, usingDotNotation);
        uval = Utils.getIn(rcd[index[ubound]], prop, usingDotNotation);
        break;
      default:
        break;
    }
    void uval;

    switch (op) {
      case '$eq':
      case '$aeq':
      case '$dteq':
        // if hole (not found)
        if (!Comparators.aeq(lval, val)) {
          return [0, -1];
        }

        return [lbound!, ubound!];

      case '$gt':
        // if hole (not found) ub position is already greater
        if (!Comparators.aeq(Utils.getIn(rcd[index[ubound!]], prop, usingDotNotation), val)) {
          return [ubound!, max];
        }
        // otherwise (found) so ubound is still equal, get next
        return [ubound! + 1, max];

      case '$gte':
        // if hole (not found) lb position marks left outside of range
        if (!Comparators.aeq(Utils.getIn(rcd[index[lbound!]], prop, usingDotNotation), val)) {
          return [lbound! + 1, max];
        }
        // otherwise (found) so lb is first position where its equal
        return [lbound!, max];

      case '$lt':
        // if hole (not found) position already is less than
        if (!Comparators.aeq(Utils.getIn(rcd[index[lbound!]], prop, usingDotNotation), val)) {
          return [min, lbound!];
        }
        // otherwise (found) so lb marks left inside of eq range, get previous
        return [min, lbound! - 1];

      case '$lte':
        // if hole (not found) ub position marks right outside so get previous
        if (!Comparators.aeq(Utils.getIn(rcd[index[ubound!]], prop, usingDotNotation), val)) {
          return [min, ubound! - 1];
        }
        // otherwise (found) so ub is last position where its still equal
        return [min, ubound!];

      default:
        return [0, rcd.length - 1];
    }
  }

  /**
   * Retrieve doc by Unique index
   * @param field - name of uniquely indexed property to use when doing lookup
   * @param value - unique value to search for
   * @returns document matching the value passed
   */
  // biome-ignore lint/suspicious/noExplicitAny: returns a document or a lookup function when value is omitted
  by(field: string, value?: any): any {
    if (value === undefined) {
      // biome-ignore lint/suspicious/noExplicitAny: unique value
      return (value: any) => {
        return this.by(field, value);
      };
    }

    const result = this.getUniqueIndex(field, true).get(value);
    if (!this.cloneObjects) {
      return result;
    }
    return clone(result, this.cloneMethod);
  }

  /**
   * Find one object by index property, by property equal to value
   * @param query - query object used to perform search with
   * @returns First matching document, or null if none
   */
  // biome-ignore lint/suspicious/noExplicitAny: query values are dynamic
  findOne(query?: LokiQuery<any>): LokiDocument<T> | null {
    query = query || {};

    // Instantiate Resultset and exec find op passing firstOnly = true param
    const result = this.chain().find(query, true).data();

    if (Array.isArray(result) && result.length === 0) {
      return null;
    }
    if (!this.cloneObjects) {
      return result[0];
    }
    return clone(result[0], this.cloneMethod);
  }

  /**
   * Chain method, used for beginning a series of chained find() and/or view() operations
   * on a collection.
   *
   * @param transform - named transform or array of transform steps
   * @param parameters - Object containing properties representing parameters to substitute
   * @returns (this) resultset, or data array if any map or join functions where called
   */
  // biome-ignore lint/suspicious/noExplicitAny: transform steps and parameters are free-form
  chain(transform?: string | any[], parameters?: any): Resultset<T> {
    const rs = new Resultset<T>(this);

    if (typeof transform === 'undefined') {
      return rs;
    }

    return rs.transform(transform, parameters);
  }

  /**
   * Find method, api is similar to mongodb.
   * for more complex queries use [chain()]{@link Collection#chain} or [where()]{@link Collection#where}.
   * @example {@tutorial Query Examples}
   * @param query - 'mongo-like' query object
   * @returns Array of matching documents
   */
  // biome-ignore lint/suspicious/noExplicitAny: query values are dynamic
  find(query?: LokiQuery<any>): LokiDocument<T>[] {
    return this.chain().find(query).data();
  }

  /**
   * Find object by unindexed field by property equal to value,
   * simply iterates and returns the first element matching the query
   */
  // biome-ignore lint/suspicious/noExplicitAny: compared value is dynamic
  findOneUnindexed(prop: string, value: any): LokiDocument<T> | null {
    let i = this.data.length;
    let doc: LokiDocument<T>;
    while (i--) {
      if (Utils.getIn(this.data[i], prop, true) === value) {
        doc = this.data[i];
        return doc;
      }
    }
    return null;
  }

  /**
   * Transaction methods
   */

  /** start the transation */
  startTransaction() {
    if (this.transactional) {
      this.cachedData = clone(this.data, this.cloneMethod);
      this.cachedIndex = this.idIndex;
      this.cachedBinaryIndex = this.binaryIndices;
      this.cachedDirtyIds = this.dirtyIds;

      // propagate startTransaction to dynamic views
      for (let idx = 0; idx < this.DynamicViews.length; idx++) {
        this.DynamicViews[idx].startTransaction();
      }
    }
  }

  /** commit the transation */
  commit() {
    if (this.transactional) {
      this.cachedData = null;
      this.cachedIndex = null;
      this.cachedBinaryIndex = null;
      this.cachedDirtyIds = null;

      // propagate commit to dynamic views
      for (let idx = 0; idx < this.DynamicViews.length; idx++) {
        this.DynamicViews[idx].commit();
      }
    }
  }

  /** roll back the transation */
  rollback() {
    if (this.transactional) {
      if (this.cachedData !== null && this.cachedIndex !== null) {
        this.data = this.cachedData;
        this.idIndex = this.cachedIndex;
        this.binaryIndices = this.cachedBinaryIndex;
        this.dirtyIds = this.cachedDirtyIds;
      }

      // propagate rollback to dynamic views
      for (let idx = 0; idx < this.DynamicViews.length; idx++) {
        this.DynamicViews[idx].rollback();
      }
    }
  }

  // async executor. This is only to enable callbacks at the end of the execution.
  // biome-ignore lint/suspicious/noExplicitAny: user function executed with no bound `this`
  async(fun: (this: any) => void, callback: () => void) {
    setTimeout(() => {
      if (typeof fun === 'function') {
        // original behaviour: `fun` is invoked without a bound `this`
        (fun as () => void)();
        callback();
      } else {
        throw new TypeError('Argument passed for async execution is not a function');
      }
    }, 0);
  }

  /**
   * Query the collection by supplying a javascript filter function.
   * @example
   * var results = coll.where(function(obj) {
   *   return obj.legs === 8;
   * });
   *
   * @param fun - filter function to run against all collection docs
   * @returns all documents which pass your filter function
   */
  // biome-ignore lint/suspicious/noExplicitAny: filter over dynamic documents
  where(fun: (obj: any) => boolean): LokiDocument<T>[] {
    return this.chain().where(fun).data();
  }

  /**
   * Map Reduce operation
   *
   * @param mapFunction - function to use as map function
   * @param reduceFunction - function to use as reduce function
   * @returns The result of your mapReduce operation
   */
  mapReduce<U = any, R = any>(
    mapFunction: (value: LokiDocument<T>, index: number, array: LokiDocument<T>[]) => U,
    reduceFunction: (array: U[]) => R,
  ): R {
    try {
      return reduceFunction(this.data.map(mapFunction));
    } catch (err) {
      throw err;
    }
  }

  /**
   * Join two collections on specified properties
   *
   * @param joinData - array of documents to 'join' to this collection
   * @param leftJoinProp - property name in collection
   * @param rightJoinProp - property name in joinData
   * @param mapFun - (Optional) map function to use
   * @param dataOptions - options to data() before input to your map function
   * @param dataOptions.removeMeta - allows removing meta before calling mapFun
   * @param dataOptions.forceClones - forcing the return of cloned objects to your map object
   * @param dataOptions.forceCloneMethod - Allows overriding the default or collection specified cloning method.
   * @returns Result of the mapping operation
   */
  eqJoin(
    // biome-ignore lint/suspicious/noExplicitAny: array, Resultset or Collection
    joinData: any,
    leftJoinProp: string | ((obj: any) => string),
    rightJoinProp: string | ((obj: any) => string),
    // biome-ignore lint/suspicious/noExplicitAny: user map function
    mapFun?: (left: any, right: any) => any,
    // biome-ignore lint/suspicious/noExplicitAny: data() options
    dataOptions?: any,
  ) {
    // logic in Resultset class
    return new Resultset<T>(this).eqJoin(
      joinData,
      leftJoinProp,
      rightJoinProp,
      mapFun,
      dataOptions,
    );
  }

  /* ------ STAGING API -------- */

  /**
   * (Staging API) create a stage and/or retrieve it
   */
  getStage(name: string) {
    if (!this.stages[name]) {
      this.stages[name] = {};
    }
    return this.stages[name];
  }

  /**
   * (Staging API) create a copy of an object and insert it into a stage
   */
  // biome-ignore lint/suspicious/noExplicitAny: staged document
  stage(stageName: string, obj: any) {
    const copy = JSON.parse(JSON.stringify(obj));
    this.getStage(stageName)[obj.$loki] = copy;
    return copy;
  }

  /**
   * (Staging API) re-attach all objects to the original collection, so indexes and views can be rebuilt
   * then create a message to be inserted in the commitlog
   * @param stageName - name of stage
   * @param message
   */
  commitStage(stageName: string, message: string) {
    const stage = this.getStage(stageName);
    let prop: string;
    const timestamp = new Date().getTime();

    for (prop in stage) {
      this.update(stage[prop]);
      this.commitLog.push({
        timestamp: timestamp,
        message: message,
        data: JSON.parse(JSON.stringify(stage[prop])),
      });
    }
    this.stages[stageName] = {};
  }

  no_op() {
    return;
  }

  extract(field: string) {
    let i = 0;
    const len = this.data.length;
    const isDotNotation = isDeepProperty(field);
    // biome-ignore lint/suspicious/noExplicitAny: dynamic property values
    const result: any[] = [];
    for (i; i < len; i += 1) {
      result.push(deepProperty(this.data[i], field, isDotNotation));
    }
    return result;
  }

  max(field: string) {
    return Math.max.apply(null, this.extract(field));
  }

  min(field: string) {
    return Math.min.apply(null, this.extract(field));
  }

  maxRecord(field: string) {
    let i = 0;
    const len = this.data.length;
    const deep = isDeepProperty(field);
    // biome-ignore lint/suspicious/noExplicitAny: dynamic property values
    const result: { index: number; value: any } = {
      index: 0,
      value: undefined,
    };
    // biome-ignore lint/suspicious/noExplicitAny: dynamic property values
    let max: any;

    for (i; i < len; i += 1) {
      if (max !== undefined) {
        if (max < deepProperty(this.data[i], field, deep)) {
          max = deepProperty(this.data[i], field, deep);
          result.index = this.data[i].$loki;
        }
      } else {
        max = deepProperty(this.data[i], field, deep);
        result.index = this.data[i].$loki;
      }
    }
    result.value = max;
    return result;
  }

  minRecord(field: string) {
    let i = 0;
    const len = this.data.length;
    const deep = isDeepProperty(field);
    // biome-ignore lint/suspicious/noExplicitAny: dynamic property values
    const result: { index: number; value: any } = {
      index: 0,
      value: undefined,
    };
    // biome-ignore lint/suspicious/noExplicitAny: dynamic property values
    let min: any;

    for (i; i < len; i += 1) {
      if (min !== undefined) {
        if (min > deepProperty(this.data[i], field, deep)) {
          min = deepProperty(this.data[i], field, deep);
          result.index = this.data[i].$loki;
        }
      } else {
        min = deepProperty(this.data[i], field, deep);
        result.index = this.data[i].$loki;
      }
    }
    result.value = min;
    return result;
  }

  extractNumerical(field: string) {
    return this.extract(field)
      .map(parseBase10)
      .filter(Number)
      .filter((n) => {
        return !Number.isNaN(n);
      });
  }

  /**
   * Calculates the average numerical value of a property
   *
   * @param field - name of property in docs to average
   * @returns average of property in all docs in the collection
   */
  avg(field: string) {
    return average(this.extractNumerical(field));
  }

  /**
   * Calculate standard deviation of a field
   * @param field
   */
  stdDev(field: string) {
    return standardDeviation(this.extractNumerical(field));
  }

  /**
   * @param field
   */
  mode(field: string) {
    // biome-ignore lint/suspicious/noExplicitAny: dictionary keyed by arbitrary values
    const dict: Record<string, any> = {};
    const data = this.extract(field);
    data.forEach((obj) => {
      if (dict[obj]) {
        dict[obj] += 1;
      } else {
        dict[obj] = 1;
      }
    });
    let max: number | undefined;
    let prop: string;
    let mode: string | undefined;
    for (prop in dict) {
      if (max) {
        if (max < dict[prop]) {
          mode = prop;
        }
      } else {
        mode = prop;
        max = dict[prop];
      }
    }
    return mode;
  }

  /**
   * @param field - property name
   */
  median(field: string) {
    const values = this.extractNumerical(field);
    values.sort(sub);

    const half = Math.floor(values.length / 2);

    if (values.length % 2) {
      return values[half];
    }
    return (values[half - 1] + values[half]) / 2.0;
  }
}

/*
 * Members shared on the prototype in the original implementation (not own/serialized properties).
 */
Collection.prototype.lokiConsoleWrapper = {
  log: () => {},
  warn: () => {},
  error: () => {},
};

/**
 * stages: a map of uniquely identified 'stages', which hold copies of objects to be
 * manipulated without affecting the data in the original collection
 */
Collection.prototype.stages = {};

/**
 * a collection of objects recording the changes applied through a commmitStage
 */
Collection.prototype.commitLog = [];
