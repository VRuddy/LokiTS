// Ported from LokiJS (lokijs.js), MIT. Main author: obeliskos (Dave), with Joe Minichino and LokiJS contributors.
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

  /** Resolves to the stored string, or `null` if the database does not exist. */
  loadDatabase(dbname: string, callback?: (value: string | null) => void): Promise<string | null> {
    const respond = () => {
      const value = Object.hasOwn(this.hashStore, dbname) ? this.hashStore[dbname].value : null;
      if (callback) {
        callback(value);
      }
      return value;
    };
    return this.answer(respond);
  }

  saveDatabase(dbname: string, dbstring: string, callback?: () => void): Promise<void> {
    const respond = () => {
      const saveCount = Object.hasOwn(this.hashStore, dbname)
        ? this.hashStore[dbname].savecount
        : 0;
      this.hashStore[dbname] = {
        savecount: saveCount + 1,
        lastsave: new Date(),
        value: dbstring,
      };
      if (callback) {
        callback();
      }
    };
    return this.answer(respond);
  }

  deleteDatabase(dbname: string, callback?: () => void): Promise<void> {
    if (Object.hasOwn(this.hashStore, dbname)) {
      delete this.hashStore[dbname];
    }
    if (typeof callback === 'function') {
      callback();
    }
    return Promise.resolve();
  }

  // Without asyncResponses the callback runs synchronously, as in the original adapter.
  private answer<T>(respond: () => T): Promise<T> {
    if (!this.options.asyncResponses) {
      return Promise.resolve(respond());
    }
    return new Promise((resolve) => {
      setTimeout(() => resolve(respond()), this.options.asyncTimeout);
    });
  }
}
