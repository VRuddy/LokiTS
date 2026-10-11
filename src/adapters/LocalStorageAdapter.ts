// Ported from LokiJS (lokijs.js), MIT. Original author: Joe Minichino and LokiJS contributors.
import { withAdapterCallback } from '../persistence/callbacks';
import { adapterError, translateDomError } from './errors';

function storage(): Storage {
  let store: Storage | undefined;
  try {
    store = (globalThis as { window?: { localStorage?: Storage } }).window?.localStorage;
  } catch (err) {
    // reading window.localStorage throws when the browser blocks site data
    throw adapterError('ENOTSUP', 'localStorage is not available', err);
  }
  if (!store) {
    throw adapterError('ENOTSUP', 'localStorage is not available');
  }
  return store;
}

const attempt = <T>(fn: () => T): Promise<T> => new Promise((resolve) => resolve(fn()));

/** Persists each database as one localStorage item (about 5 MB per origin). */
export class LokiLocalStorageAdapter {
  loadDatabase(dbname: string, callback?: (result: any) => void): Promise<string | null> {
    return withAdapterCallback(
      attempt(() => storage().getItem(dbname)),
      callback,
      'load',
    ) as Promise<string | null>;
  }

  saveDatabase(dbname: string, dbstring: string, callback?: (err?: any) => void): Promise<void> {
    const save = attempt(() => {
      const store = storage();
      try {
        store.setItem(dbname, dbstring);
      } catch (err) {
        const translated = translateDomError(err, `saving ${dbname} to localStorage`);
        if ((translated as { code?: string }).code === 'EQUOTA') {
          throw adapterError(
            'EQUOTA',
            `localStorage is full while saving ${dbname}: use LokiIndexedDBAdapter or LokiOpfsAdapter for larger databases`,
            err,
          );
        }
        throw translated;
      }
    });
    return withAdapterCallback(save, callback, 'write') as Promise<void>;
  }

  deleteDatabase(dbname: string, callback?: (err?: any) => void): Promise<void> {
    return withAdapterCallback(
      attempt(() => storage().removeItem(dbname)),
      callback,
      'write',
    ) as Promise<void>;
  }
}
