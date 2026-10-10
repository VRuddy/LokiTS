// Ported from LokiJS (lokijs.js), MIT. Main author: obeliskos (Dave), with Joe Minichino and LokiJS contributors.
import { Loki } from '../core/Loki';
import { callAdapter } from '../persistence/adapter-bridge';
import { withAdapterCallback } from '../persistence/callbacks';
import { readCollection, writeCollection } from './partitioning/collection-io';
import {
  buildContainer,
  canListKeys,
  isGenerationKey,
  type PartitionEntry,
  type PartitionManifest,
  readManifest,
} from './partitioning/format';
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
  /** Commit through a manifest in the container (default: true); false keeps the historical layout. */
  generations?: boolean;
}

interface CommittedState {
  generation: number;
  collections: PartitionEntry[];
  /** keys of a historical layout, removed once the database is converted */
  legacyKeys: string[];
}

const randomSuffix = () => Math.random().toString(36).slice(2, 6).padEnd(4, '0');

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
 * @param options.generations - (default: true) false writes the historical layout, readable by LokiJS.
 */
export class LokiPartitioningAdapter {
  mode!: 'reference';
  adapter!: any;
  options!: LokiPartitioningAdapterOptions;
  /** What is committed for each database, so a save knows which files to keep and which to clean up. */
  declare states: Map<string, CommittedState>;

  constructor(adapter?: any, options?: LokiPartitioningAdapterOptions) {
    this.states = new Map();
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

    if (!Object.hasOwn(this.options, 'generations')) {
      this.options.generations = true;
    }
  }

  /** Loads a database saved as one key per collection (and per page with paging). */
  loadDatabase(dbname: string, callback?: (result: any) => void): Promise<Loki | null | undefined> {
    return withAdapterCallback(this.load(dbname), callback, 'load');
  }

  /** Reference mode: writes the dirty collections under a new generation, then commits by replacing the container. */
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
    // falsy: the container does not exist, so neither does the database
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
      this.states.delete(dbname);
      return container as null | undefined;
    }
    const dbref = new Loki(dbname);
    dbref.loadJSONObject(container);
    const manifest = readManifest(container);

    if (!manifest) {
      await loadLegacyCollections(this.adapter, dbname, dbref, this.legacyOptions());
      this.states.set(dbname, {
        generation: 0,
        collections: [],
        legacyKeys: await legacyKeys(
          this.adapter,
          dbname,
          dbref.collections.length,
          this.legacyOptions(),
        ),
      });
      return dbref;
    }

    for (let index = 0; index < dbref.collections.length; index++) {
      const entry = manifest.collections[index];
      if (!entry || entry.name !== dbref.collections[index].name) {
        throw new Error(
          'LokiPartitioningAdapter: the partition manifest does not match the container',
        );
      }
      dbref.collections[index].data = await readCollection(this.adapter, entry.files);
    }
    this.states.set(dbname, {
      generation: manifest.generation,
      collections: manifest.collections,
      legacyKeys: [],
    });
    return dbref;
  }

  private async save(dbname: string, dbref: Loki): Promise<void> {
    if (!this.options.generations) {
      return saveLegacy(this.adapter, dbname, dbref, this.legacyOptions());
    }

    const previous = this.states.get(dbname) ?? (await this.readCommittedState(dbname));
    const generation = previous.generation + 1;
    const suffix = randomSuffix();
    const committedFiles = new Map(previous.collections.map((entry) => [entry.name, entry.files]));
    const collections: PartitionEntry[] = [];

    for (let index = 0; index < dbref.collections.length; index++) {
      const collection = dbref.collections[index];
      const current = committedFiles.get(collection.name);
      if (current && !collection.dirty) {
        collections.push({ name: collection.name, files: current });
        continue;
      }
      const files = await writeCollection(
        this.adapter,
        `${dbname}.${index}.g${generation}-${suffix}`,
        collection.data,
        { enabled: this.options.paging === true, pageSize: this.options.pageSize as number },
      );
      collections.push({ name: collection.name, files });
    }

    const manifest: PartitionManifest = { version: 1, generation, collections };
    // the commit: until the container is replaced, loaders still see the previous files
    await callAdapter(
      this.adapter,
      'saveDatabase',
      [dbname, buildContainer(dbref, manifest)],
      'write',
    );
    this.states.set(dbname, { generation, collections, legacyKeys: [] });

    await this.cleanUp(dbname, manifest, previous).catch(() => {
      // the commit succeeded; leftover files are orphans removed by a later save
    });
  }

  private async readCommittedState(dbname: string): Promise<CommittedState> {
    const container = await this.readContainer(dbname);
    const manifest = container ? readManifest(container) : undefined;
    if (manifest) {
      return {
        generation: manifest.generation,
        collections: manifest.collections,
        legacyKeys: [],
      };
    }
    const count =
      container && Array.isArray(container.collections) ? container.collections.length : 0;
    return {
      generation: 0,
      collections: [],
      legacyKeys: container
        ? await legacyKeys(this.adapter, dbname, count, this.legacyOptions())
        : [],
    };
  }

  private async cleanUp(
    dbname: string,
    manifest: PartitionManifest,
    previous: CommittedState,
  ): Promise<void> {
    const kept = new Set(manifest.collections.flatMap((entry) => entry.files));
    const obsolete = new Set<string>(previous.legacyKeys);
    for (const entry of previous.collections) {
      for (const file of entry.files) {
        if (!kept.has(file)) {
          obsolete.add(file);
        }
      }
    }
    if (canListKeys(this.adapter)) {
      for (const key of await this.adapter.listKeys(`${dbname}.`)) {
        if (isGenerationKey(dbname, key) && !kept.has(key)) {
          obsolete.add(key);
        }
      }
    }
    await deleteAll(this.adapter, obsolete);
  }

  private async remove(dbname: string): Promise<void> {
    const container = await this.readContainer(dbname);
    this.states.delete(dbname);
    if (!container) {
      return;
    }
    const manifest = readManifest(container);
    // probed before the container goes: paged keys are discovered by reading the storage
    const keys = new Set<string>(
      manifest
        ? manifest.collections.flatMap((entry) => entry.files)
        : await legacyKeys(
            this.adapter,
            dbname,
            Array.isArray(container.collections) ? container.collections.length : 0,
            this.legacyOptions(),
          ),
    );

    await callAdapter(this.adapter, 'deleteDatabase', [dbname], 'write');
    if (canListKeys(this.adapter)) {
      for (const key of await this.adapter.listKeys(`${dbname}.`)) {
        if (isGenerationKey(dbname, key)) {
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
