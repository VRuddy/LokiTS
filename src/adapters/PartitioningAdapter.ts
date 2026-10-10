// Ported from LokiJS (lokijs.js), MIT. Main author: obeliskos (Dave), with Joe Minichino and LokiJS contributors.
import { Loki } from '../core/Loki';
import { callAdapter } from '../persistence/adapter-bridge';
import { withAdapterCallback } from '../persistence/callbacks';

/** Options for {@link LokiPartitioningAdapter}. */
export interface LokiPartitioningAdapterOptions {
  paging?: boolean;
  pageSize?: number;
  delimiter?: string;
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
 *
 * @param adapter - reference to a 'non-reference' mode loki adapter instance.
 * @param options - configuration options for partitioning and paging
 * @param options.paging - (default: false) set to true to enable paging collection data.
 * @param options.pageSize - (default : 25MB) you can use this to limit size of strings passed to inner adapter.
 * @param options.delimiter - allows you to override the default delimeter
 */
export class LokiPartitioningAdapter {
  mode!: 'reference';
  adapter!: any;
  options!: LokiPartitioningAdapterOptions;
  dbref!: Loki | null;
  dbname!: string;
  pageIterator!: any;
  /** assigned in exportDatabase */
  dirtyPartitions!: number[];

  constructor(adapter?: any, options?: LokiPartitioningAdapterOptions) {
    this.mode = 'reference';
    this.adapter = null;
    this.options = options || {};
    this.dbref = null;
    this.dbname = '';
    this.pageIterator = {};

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
  }

  /** Loads a database saved as one key per collection (and per page with paging). */
  loadDatabase(dbname: string, callback?: (result: any) => void): Promise<Loki | null | undefined> {
    return withAdapterCallback(this.loadPartitions(dbname), callback, 'load');
  }

  /** Reference mode: saves the container, then each dirty collection under its own key. */
  exportDatabase(dbname: string, dbref: Loki, callback?: (err?: any) => void): Promise<void> {
    return withAdapterCallback(
      this.savePartitions(dbname, dbref),
      callback,
      'write',
    ) as Promise<void>;
  }

  private async loadPartitions(dbname: string): Promise<Loki | null | undefined> {
    this.dbname = dbname;
    const dbref = new Loki(dbname);
    this.dbref = dbref;

    const container = await callAdapter(this.adapter, 'loadDatabase', [dbname], 'load');
    // falsy: partition 0 does not exist, so neither does the database
    if (!container) {
      return container as null | undefined;
    }
    if (typeof container !== 'string') {
      throw new Error(
        'LokiPartitioningAdapter received an unexpected response from inner adapter loadDatabase()',
      );
    }
    dbref.loadJSONObject(JSON.parse(container));

    for (let partition = 0; partition < dbref.collections.length; partition++) {
      if (this.options.paging === true) {
        await this.loadPages(partition);
      } else {
        const keyname = `${dbname}.${partition}`;
        const result = await callAdapter(this.adapter, 'loadDatabase', [keyname], 'load');
        dbref.collections[partition].data = dbref.deserializeCollection(result as string, {
          delimited: true,
          collectionIndex: partition,
        });
      }
    }
    return dbref;
  }

  private async loadPages(collectionIndex: number): Promise<void> {
    const collection = (this.dbref as Loki).collections[collectionIndex];
    const delimiter = this.options.delimiter as string;
    this.pageIterator = { collection: collectionIndex, pageIndex: 0 };

    for (;;) {
      const keyname = `${this.dbname}.${collectionIndex}.${this.pageIterator.pageIndex}`;
      const result = (await callAdapter(this.adapter, 'loadDatabase', [keyname], 'load')) as string;
      const rows = result.split(delimiter);

      // a final empty row marks the last page; an empty collection is a lone delimiter
      const isLastPage = rows[rows.length - 1] === '';
      if (isLastPage) {
        rows.pop();
        if (rows.length === 1 && rows[0] === '') {
          rows.pop();
        }
      }
      for (const row of rows) {
        collection.data.push(JSON.parse(row));
      }

      if (isLastPage) {
        return;
      }
      this.pageIterator.pageIndex++;
    }
  }

  private async savePartitions(dbname: string, dbref: Loki): Promise<void> {
    this.dbref = dbref;
    this.dbname = dbname;

    // -1 is the container (the database without collection data)
    this.dirtyPartitions = [-1];
    for (let idx = 0; idx < dbref.collections.length; idx++) {
      if (dbref.collections[idx].dirty) {
        this.dirtyPartitions.push(idx);
      }
    }

    while (this.dirtyPartitions.length > 0) {
      const partition = this.dirtyPartitions.shift() as number;
      if (this.options.paging && partition !== -1) {
        await this.savePages(partition);
        continue;
      }
      const keyname = dbname + (partition === -1 ? '' : `.${partition}`);
      const result = dbref.serializeDestructured({
        partitioned: true,
        delimited: true,
        partition: partition,
      });
      await callAdapter(this.adapter, 'saveDatabase', [keyname, result], 'write');
    }
  }

  private async savePages(collectionIndex: number): Promise<void> {
    const collection = (this.dbref as Loki).collections[collectionIndex];
    const delimiter = this.options.delimiter as string;
    const pageSize = this.options.pageSize as number;
    const docCount = collection.data.length;
    let doneWithPartition = docCount === 0;
    this.pageIterator = { collection: collectionIndex, docIndex: 0, pageIndex: 0 };

    for (;;) {
      const keyname = `${this.dbname}.${collectionIndex}.${this.pageIterator.pageIndex}`;
      let pageBuilder = '';
      let pageLen = 0;
      let doneWithPage = false;

      for (;;) {
        if (!doneWithPartition) {
          const serializedObject = JSON.stringify(collection.data[this.pageIterator.docIndex]);
          pageBuilder += serializedObject;
          pageLen += serializedObject.length;
          if (++this.pageIterator.docIndex >= docCount) {
            doneWithPartition = true;
          }
        }
        if (pageLen >= pageSize) {
          doneWithPage = true;
        }
        // a delimiter between rows, and a final one after the last row of the partition
        if (!doneWithPage || doneWithPartition) {
          pageBuilder += delimiter;
          pageLen += delimiter.length;
        }
        if (doneWithPartition || doneWithPage) {
          break;
        }
      }

      await callAdapter(this.adapter, 'saveDatabase', [keyname, pageBuilder], 'write');
      if (doneWithPartition) {
        return;
      }
      this.pageIterator.pageIndex++;
    }
  }
}
