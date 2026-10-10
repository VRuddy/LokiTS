// Ported from LokiJS (lokijs.js), MIT. Main author: obeliskos (Dave), with Joe Minichino and LokiJS contributors.
import { Loki } from '../core/Loki';
import { callAdapter } from '../persistence/adapter-bridge';
import { withAdapterCallback } from '../persistence/callbacks';
import { canListKeys, isPartitionKey } from './partitioning/format';
import {
  type LegacyFormat,
  type LegacyOptions,
  legacyKeys,
  loadLegacyCollections,
  saveLegacy,
} from './partitioning/legacy';

/** Options for {@link LokiPartitioningAdapter}. */
export interface LokiPartitioningAdapterOptions {
  paging?: boolean;
  pageSize?: number;
  delimiter?: string;
  /** Historical layout to read (and to write with `generations: false`): `'lines'` is the fs-structured one. */
  legacyFormat?: LegacyFormat;
}

/**
 * An adapter for adapters.  Converts a non reference mode adapter into a reference mode adapter
 * which can perform destructuring and partioning.  Each collection will be stored in its own key/save and
 * only dirty collections will be saved.  If you  turn on paging with default page size of 25megs and save
 * a 75 meg collection it should use up roughly 3 save slots (key/value pairs sent to inner adapter).
 * A dirty collection that spans three pages will save all three pages again
 * Paging mode was added mainly because Chrome has issues saving 'too large' of a string within a
 * single indexeddb row.  If a single document update causes the collection to be flagged as dirty, all
 * of that collection's pages will be written on next save.
 * With `legacyFormat: 'lines'` each partition holds one JSON document per line, the layout of the
 * original loki-fs-structured-adapter.
 *
 * @param adapter - reference to a 'non-reference' mode loki adapter instance.
 * @param options - configuration options for partitioning and paging
 * @param options.paging - (default: false) set to true to enable paging collection data.
 * @param options.pageSize - (default : 25MB) you can use this to limit size of strings passed to inner adapter.
 * @param options.delimiter - allows you to override the default delimeter
 * @param options.legacyFormat - (default: 'partitioning') 'lines' for the fs-structured layout.
 */
export class LokiPartitioningAdapter {
  mode!: 'reference';
  adapter!: any;
  options!: LokiPartitioningAdapterOptions;

  constructor(adapter?: any, options?: LokiPartitioningAdapterOptions) {
    this.mode = 'reference';
    this.adapter = null;
    this.options = options || {};

    // verify user passed an appropriate adapter
    if (adapter) {
      if (adapter.mode === 'reference') {
        throw new Error(
          'LokiPartitioningAdapter cannot be instantiated with a reference mode adapter',
        );
      }
      this.adapter = adapter;
    } else {
      throw new Error(
        'LokiPartitioningAdapter requires a (non-reference mode) adapter on construction',
      );
    }

    // set collection paging defaults
    if (!Object.hasOwn(this.options, 'paging')) {
      this.options.paging = false;
    }

    // default to page size of 25 megs (can be up to your largest serialized object size larger than this)
    if (!Object.hasOwn(this.options, 'pageSize')) {
      this.options.pageSize = 25 * 1024 * 1024;
    }

    if (!Object.hasOwn(this.options, 'delimiter')) {
      this.options.delimiter = '$<\n';
    }

    if (!Object.hasOwn(this.options, 'legacyFormat')) {
      this.options.legacyFormat = 'partitioning';
    }
  }

  /** Loads a database saved as one key per collection (and per page with paging). */
  loadDatabase(dbname: string, callback?: (result: any) => void): Promise<Loki | null | undefined> {
    return withAdapterCallback(this.load(dbname), callback, 'load');
  }

  /** Reference mode: saves the container, then each dirty collection under its own key. */
  exportDatabase(dbname: string, dbref: Loki, callback?: (err?: any) => void): Promise<void> {
    return withAdapterCallback(this.save(dbname, dbref), callback, 'write') as Promise<void>;
  }

  /** Deletes the container first (the database is then gone for a loader), then every partition. */
  deleteDatabase(dbname: string, callback?: (err?: any) => void): Promise<void> {
    return withAdapterCallback(this.remove(dbname), callback, 'write') as Promise<void>;
  }

  private legacyOptions(): LegacyOptions {
    return {
      format: this.options.legacyFormat as LegacyFormat,
      paging: this.options.paging === true,
      pageSize: this.options.pageSize as number,
      delimiter: this.options.delimiter as string,
    };
  }

  private async readContainer(dbname: string): Promise<Record<string, any> | null | undefined> {
    const text = await callAdapter(this.adapter, 'loadDatabase', [dbname], 'load');
    // falsy: partition 0 does not exist, so neither does the database
    if (!text) {
      return text as null | undefined;
    }
    if (typeof text !== 'string') {
      throw new Error(
        'LokiPartitioningAdapter received an unexpected response from inner adapter loadDatabase()',
      );
    }
    return JSON.parse(text);
  }

  private async load(dbname: string): Promise<Loki | null | undefined> {
    const container = await this.readContainer(dbname);
    if (!container) {
      return container as null | undefined;
    }
    const dbref = new Loki(dbname);
    dbref.loadJSONObject(container);
    await loadLegacyCollections(this.adapter, dbname, dbref, this.legacyOptions());
    return dbref;
  }

  private save(dbname: string, dbref: Loki): Promise<void> {
    return saveLegacy(this.adapter, dbname, dbref, this.legacyOptions());
  }

  private async remove(dbname: string): Promise<void> {
    const container = await this.readContainer(dbname);
    if (!container) {
      return;
    }
    const collectionCount = Array.isArray(container.collections) ? container.collections.length : 0;
    // probed before the container goes: paged keys are discovered by reading the storage
    const keys = new Set(
      await legacyKeys(this.adapter, dbname, collectionCount, this.legacyOptions()),
    );

    await callAdapter(this.adapter, 'deleteDatabase', [dbname], 'write');
    if (canListKeys(this.adapter)) {
      for (const key of await this.adapter.listKeys(`${dbname}.`)) {
        if (isPartitionKey(dbname, key)) {
          keys.add(key);
        }
      }
    }
    await deleteAll(this.adapter, keys);
  }
}

/** Deletes every key, then reports the first failure, if any. */
export async function deleteAll(inner: object, keys: Iterable<string>): Promise<void> {
  let failure: unknown;
  for (const key of keys) {
    try {
      await callAdapter(inner, 'deleteDatabase', [key], 'write');
    } catch (err) {
      failure ??= err;
    }
  }
  if (failure !== undefined) {
    throw failure;
  }
}
