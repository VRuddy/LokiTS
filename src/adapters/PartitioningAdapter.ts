// Ported from LokiJS (src/lokijs.js), MIT. Main author: obeliskos (Dave), with Joe Minichino and LokiJS contributors.
import { Loki } from '../core/Loki';

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
  mode!: string;
  // biome-ignore lint/suspicious/noExplicitAny: inner adapter follows the callback adapter contract
  adapter!: any;
  options!: LokiPartitioningAdapterOptions;
  dbref!: Loki | null;
  dbname!: string;
  // biome-ignore lint/suspicious/noExplicitAny: iterator state is built incrementally
  pageIterator!: any;
  /** assigned in exportDatabase */
  dirtyPartitions!: number[];

  // biome-ignore lint/suspicious/noExplicitAny: inner adapter follows the callback adapter contract
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

  /**
   * Loads a database which was partitioned into several key/value saves.
   * (Loki persistence adapter interface function)
   *
   * @param dbname - name of the database (filename/keyname)
   * @param callback - adapter callback to return load result to caller
   */
  // biome-ignore lint/suspicious/noExplicitAny: callback receives db, Error or falsy
  loadDatabase(dbname: string, callback: (result: any) => void): void {
    this.dbname = dbname;
    this.dbref = new Loki(dbname);

    // load the db container (without data)
    // biome-ignore lint/suspicious/noExplicitAny: inner adapter result is string, Error or falsy
    this.adapter.loadDatabase(dbname, (result: any) => {
      // empty database condition is for inner adapter return null/undefined/falsy
      if (!result) {
        // partition 0 not found so new database, no need to try to load other partitions.
        // return same falsy result to loadDatabase to signify no database exists (yet)
        callback(result);
        return;
      }

      if (typeof result !== 'string') {
        callback(
          new Error(
            'LokiPartitioningAdapter received an unexpected response from inner adapter loadDatabase()',
          ),
        );
      }

      // I will want to use loki destructuring helper methods so i will inflate into typed instance
      let db = JSON.parse(result);
      (this.dbref as Loki).loadJSONObject(db);
      db = null;

      if ((this.dbref as Loki).collections.length === 0) {
        callback(this.dbref);
        return;
      }

      this.pageIterator = {
        collection: 0,
        pageIndex: 0,
      };

      this.loadNextPartition(0, () => {
        callback(this.dbref);
      });
    });
  }

  /**
   * Used to sequentially load each collection partition, one at a time.
   *
   * @param partition - ordinal collection position to load next
   * @param callback - adapter callback to return load result to caller
   */
  loadNextPartition(partition: number, callback: () => void): void {
    const keyname = `${this.dbname}.${partition}`;

    if (this.options.paging === true) {
      this.pageIterator.pageIndex = 0;
      this.loadNextPage(callback);
      return;
    }

    // biome-ignore lint/suspicious/noExplicitAny: inner adapter result is a string
    this.adapter.loadDatabase(keyname, (result: any) => {
      const dbref = this.dbref as Loki;
      const data = dbref.deserializeCollection(result, {
        delimited: true,
        collectionIndex: partition,
      });
      dbref.collections[partition].data = data;

      if (++partition < dbref.collections.length) {
        this.loadNextPartition(partition, callback);
      } else {
        callback();
      }
    });
  }

  /**
   * Used to sequentially load the next page of collection partition, one at a time.
   *
   * @param callback - adapter callback to return load result to caller
   */
  loadNextPage(callback: () => void): void {
    // calculate name for next saved page in sequence
    const keyname = `${this.dbname}.${this.pageIterator.collection}.${this.pageIterator.pageIndex}`;

    // load whatever page is next in sequence
    // biome-ignore lint/suspicious/noExplicitAny: inner adapter result is a string
    this.adapter.loadDatabase(keyname, (result: any) => {
      // biome-ignore lint/suspicious/noExplicitAny: array of strings, then nulls
      let data: any[] = result.split(this.options.delimiter);
      result = ''; // free up memory now that we have split it into array
      let dlen = data.length;
      let idx: number;

      // detect if last page by presence of final empty string element and remove it if so
      const isLastPage = data[dlen - 1] === '';
      if (isLastPage) {
        data.pop();
        dlen = data.length;
        // empty collections are just a delimiter meaning two blank items
        if (data[dlen - 1] === '' && dlen === 1) {
          data.pop();
          dlen = data.length;
        }
      }

      // convert stringified array elements to object instances and push to collection data
      for (idx = 0; idx < dlen; idx++) {
        (this.dbref as Loki).collections[this.pageIterator.collection].data.push(
          JSON.parse(data[idx]),
        );
        data[idx] = null;
      }
      data = [];

      // if last page, we are done with this partition
      if (isLastPage) {
        // if there are more partitions, kick off next partition load
        if (++this.pageIterator.collection < (this.dbref as Loki).collections.length) {
          this.loadNextPartition(this.pageIterator.collection, callback);
        } else {
          callback();
        }
      } else {
        this.pageIterator.pageIndex++;
        this.loadNextPage(callback);
      }
    });
  }

  /**
   * Saves a database by partioning into separate key/value saves.
   * (Loki 'reference mode' persistence adapter interface function)
   *
   * @param dbname - name of the database (filename/keyname)
   * @param dbref - reference to database which we will partition and save.
   * @param callback - adapter callback to return load result to caller
   *
   */
  // biome-ignore lint/suspicious/noExplicitAny: callback receives errors of any shape
  exportDatabase(dbname: string, dbref: Loki, callback: (err?: any) => void): void {
    let idx: number;
    const clen = dbref.collections.length;

    this.dbref = dbref;
    this.dbname = dbname;

    // queue up dirty partitions to be saved
    this.dirtyPartitions = [-1];
    for (idx = 0; idx < clen; idx++) {
      if (dbref.collections[idx].dirty) {
        this.dirtyPartitions.push(idx);
      }
    }

    this.saveNextPartition((err) => {
      callback(err);
    });
  }

  /**
   * Helper method used internally to save each dirty collection, one at a time.
   *
   * @param callback - adapter callback to return load result to caller
   */
  // biome-ignore lint/suspicious/noExplicitAny: callback receives errors of any shape
  saveNextPartition(callback: (err?: any) => void): void {
    const partition = this.dirtyPartitions.shift() as number;
    const keyname = this.dbname + (partition === -1 ? '' : `.${partition}`);

    // if we are doing paging and this is collection partition
    if (this.options.paging && partition !== -1) {
      this.pageIterator = {
        collection: partition,
        docIndex: 0,
        pageIndex: 0,
      };

      // since saveNextPage recursively calls itself until done, our callback means this whole paged partition is finished
      // biome-ignore lint/suspicious/noExplicitAny: callback receives errors of any shape
      this.saveNextPage((err?: any) => {
        if (this.dirtyPartitions.length === 0) {
          callback(err);
        } else {
          this.saveNextPartition(callback);
        }
      });
      return;
    }

    // otherwise this is 'non-paged' partioning...
    const result = (this.dbref as Loki).serializeDestructured({
      partitioned: true,
      delimited: true,
      partition: partition,
    });

    // biome-ignore lint/suspicious/noExplicitAny: callback receives errors of any shape
    this.adapter.saveDatabase(keyname, result, (err?: any) => {
      if (err) {
        callback(err);
        return;
      }

      if (this.dirtyPartitions.length === 0) {
        callback(null);
      } else {
        this.saveNextPartition(callback);
      }
    });
  }

  /**
   * Helper method used internally to generate and save the next page of the current (dirty) partition.
   *
   * @param callback - adapter callback to return load result to caller
   */
  // biome-ignore lint/suspicious/noExplicitAny: callback receives errors of any shape
  saveNextPage(callback: (err?: any) => void): void {
    const coll = (this.dbref as Loki).collections[this.pageIterator.collection];
    const keyname = `${this.dbname}.${this.pageIterator.collection}.${this.pageIterator.pageIndex}`;
    let pageLen = 0;
    const cdlen = coll.data.length;
    const delimlen = (this.options.delimiter as string).length;
    let serializedObject = '';
    let pageBuilder = '';
    let doneWithPartition = false;
    let doneWithPage = false;

    // biome-ignore lint/suspicious/noExplicitAny: callback receives errors of any shape
    const pageSaveCallback = (err?: any) => {
      pageBuilder = '';

      if (err) {
        callback(err);
      }

      // update meta properties then continue process by invoking callback
      if (doneWithPartition) {
        callback(null);
      } else {
        this.pageIterator.pageIndex++;
        this.saveNextPage(callback);
      }
    };

    if (coll.data.length === 0) {
      doneWithPartition = true;
    }

    while (true) {
      if (!doneWithPartition) {
        // serialize object
        serializedObject = JSON.stringify(coll.data[this.pageIterator.docIndex]);
        pageBuilder += serializedObject;
        pageLen += serializedObject.length;

        // if no more documents in collection to add, we are done with partition
        if (++this.pageIterator.docIndex >= cdlen) doneWithPartition = true;
      }
      // if our current page is bigger than defined pageSize, we are done with page
      if (pageLen >= (this.options.pageSize as number)) doneWithPage = true;

      // if not done with current page, need delimiter before next item
      // if done with partition we also want a delmiter to indicate 'end of pages' final empty row
      if (!doneWithPage || doneWithPartition) {
        pageBuilder += this.options.delimiter;
        pageLen += delimlen;
      }

      // if we are done with page save it and pass off to next recursive call or callback
      if (doneWithPartition || doneWithPage) {
        this.adapter.saveDatabase(keyname, pageBuilder, pageSaveCallback);
        return;
      }
    }
  }
}
