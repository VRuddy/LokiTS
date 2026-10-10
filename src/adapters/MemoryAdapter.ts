// Ported from LokiJS (src/lokijs.js), MIT. Main author: obeliskos (Dave), with Joe Minichino and LokiJS contributors.
/** Options for {@link LokiMemoryAdapter}. */
export interface LokiMemoryAdapterOptions {
  asyncResponses?: boolean;
  asyncTimeout?: number;
}

/**
 * In in-memory persistence adapter for an in-memory database.
 * This simple 'key/value' adapter is intended for unit testing and diagnostics.
 *
 * @param options - memory adapter options
 * @param options.asyncResponses - (default: false) whether callbacks are invoked asynchronously
 * @param options.asyncTimeout - (default: 50) timeout in ms to queue callbacks
 */
export class LokiMemoryAdapter {
  hashStore!: Record<string, { savecount: number; lastsave: Date; value: string }>;
  options!: LokiMemoryAdapterOptions;

  constructor(options?: LokiMemoryAdapterOptions) {
    this.hashStore = {};
    this.options = options || {};

    if (!Object.hasOwn(this.options, 'asyncResponses')) {
      this.options.asyncResponses = false;
    }

    if (!Object.hasOwn(this.options, 'asyncTimeout')) {
      this.options.asyncTimeout = 50; // 50 ms default
    }
  }

  /**
   * Loads a serialized database from its in-memory store.
   * (Loki persistence adapter interface function)
   *
   * @param dbname - name of the database (filename/keyname)
   * @param callback - adapter callback to return load result to caller
   */
  loadDatabase(dbname: string, callback: (value: string | null) => void): void {
    if (this.options.asyncResponses) {
      setTimeout(() => {
        if (Object.hasOwn(this.hashStore, dbname)) {
          callback(this.hashStore[dbname].value);
        } else {
          // database doesn't exist, return falsy
          callback(null);
        }
      }, this.options.asyncTimeout);
    } else {
      if (Object.hasOwn(this.hashStore, dbname)) {
        // database doesn't exist, return falsy
        callback(this.hashStore[dbname].value);
      } else {
        callback(null);
      }
    }
  }

  /**
   * Saves a serialized database to its in-memory store.
   * (Loki persistence adapter interface function)
   *
   * @param dbname - name of the database (filename/keyname)
   * @param dbstring - serialized database
   * @param callback - adapter callback to return load result to caller
   */
  saveDatabase(dbname: string, dbstring: string, callback: () => void): void {
    let saveCount: number;

    if (this.options.asyncResponses) {
      setTimeout(() => {
        saveCount = Object.hasOwn(this.hashStore, dbname) ? this.hashStore[dbname].savecount : 0;

        this.hashStore[dbname] = {
          savecount: saveCount + 1,
          lastsave: new Date(),
          value: dbstring,
        };

        callback();
      }, this.options.asyncTimeout);
    } else {
      saveCount = Object.hasOwn(this.hashStore, dbname) ? this.hashStore[dbname].savecount : 0;

      this.hashStore[dbname] = {
        savecount: saveCount + 1,
        lastsave: new Date(),
        value: dbstring,
      };

      callback();
    }
  }

  /**
   * Deletes a database from its in-memory store.
   *
   * @param dbname - name of the database (filename/keyname)
   * @param callback - function to call when done
   */
  deleteDatabase(dbname: string, callback?: () => void): void {
    if (Object.hasOwn(this.hashStore, dbname)) {
      delete this.hashStore[dbname];
    }

    if (typeof callback === 'function') {
      callback();
    }
  }
}
